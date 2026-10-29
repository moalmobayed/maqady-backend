import { Injectable } from '@nestjs/common';
import { AccessTokenService } from '../../common/auth/access-token.service';
import { ACCESS_TOKEN_TTL_SECONDS } from '../../common/auth/auth.constants';
import type { CustomerPrincipal } from '../../common/auth/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { addToInstant } from '../../common/time/time';
import { ONE_TIME_TOKEN_LIFETIME_SECONDS, SESSION_LIFETIME_SECONDS } from '../auth/auth.constants';
import { OneTimeTokenService } from '../auth/one-time-token.service';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import { MessagingService } from '../messaging/messaging.service';
import { toCustomer } from './customer.mapper';
import { CustomerService } from './customer.service';
import { CustomersRepository } from './customers.repository';
import { customerVerifyEmailTemplate } from './templates/customer-verify-email.template';
import type {
  CustomerRow,
  CustomerSession,
  CustomerSignInInput,
  CustomerTokens,
  RegisterCustomerInput,
  ResetPasswordInput,
} from './types';

/**
 * Customer sign-up, sign-in, refresh and sign-out, email verification and password reset
 * (design §10, §11 "Public and customer routes"), on U2a's shared credentials with the customer
 * lifetimes: sessions of 30 days from sign-in, verification links of 24 hours, reset links of 1.
 *
 * Every method but `refresh` joins the request transaction, so a refusal rolls back everything
 * it wrote, including a consumed link.
 */
@Injectable()
export class CustomerAuthService {
  constructor(
    private readonly customers: CustomersRepository,
    private readonly customerService: CustomerService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly oneTimeTokens: OneTimeTokenService,
    private readonly accessTokens: AccessTokenService,
    private readonly messaging: MessagingService,
    private readonly transactions: TransactionRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * Creates the account, queues the verification email and signs the customer in (PRD C7: the
   * frontend goes straight on to claim the hold). A live account with the email, in any case, is
   * `EMAIL_TAKEN`, and nothing is written.
   */
  async register(input: RegisterCustomerInput): Promise<CustomerSession> {
    const passwordHash = await this.passwords.hash(input.password);
    return this.transactions.run(async () => {
      const now = this.clock.now();
      const row = await this.customers.insertIfEmailFree({
        email: input.email,
        full_name: input.fullName,
        phone: null,
        password_hash: passwordHash,
        status: 'active',
        last_sign_in_at: now,
        created_at: now,
        updated_at: now,
      });
      if (!row) throw new AppError('EMAIL_TAKEN');
      await this.queueVerification(row);
      return { customer: toCustomer(row), tokens: await this.openSession(row.id) };
    });
  }

  /**
   * Checks the email and password and opens a session.
   *
   * - A wrong password and an unknown (or anonymised) email are both `INVALID_CREDENTIALS`,
   *   after the same scrypt work, so neither the answer nor its timing tells whether the email
   *   has an account.
   * - A blocked customer gets `ACCOUNT_BLOCKED`, but only once the password matched.
   * - The sign-in is recorded first, by an update that matches only a live, active customer
   *   whose hash is still the one checked, so it waits for a block, password change or reset in
   *   flight and is refused by it: no session opens beside their revocation and outlives it.
   */
  async signIn(input: CustomerSignInInput): Promise<CustomerSession> {
    return this.transactions.run(async () => {
      const row = await this.customers.findLiveByEmail(input.email);
      const matches = await this.passwords.verify(input.password, row?.password_hash ?? null);
      if (!row || !row.password_hash || !matches) throw new AppError('INVALID_CREDENTIALS');
      if (row.status !== 'active') throw new AppError('ACCOUNT_BLOCKED');

      const signedIn = await this.customers.recordSignIn(
        row.id,
        row.password_hash,
        this.clock.now(),
      );
      if (!signedIn) throw await this.signInRefusal(row);
      return { customer: toCustomer(signedIn), tokens: await this.openSession(row.id) };
    });
  }

  /**
   * Rotates a refresh token (see `SessionService.refresh`). A customer who was blocked gets
   * `ACCOUNT_BLOCKED` and keeps the old token; one anonymised or gone, `UNAUTHENTICATED`. Runs
   * outside the request transaction.
   */
  async refresh(refreshToken: string): Promise<CustomerTokens> {
    const session = await this.sessions.refresh({
      audience: 'customer',
      refreshToken,
      assertOwnerLive: (customerId) => this.assertLive(customerId),
    });
    return this.tokensFor(
      session.ownerId,
      session.sessionId,
      session.refreshToken,
      session.expiresAt,
    );
  }

  /** Ends the caller's session family; its access and refresh tokens stop working at once. */
  async signOut(principal: CustomerPrincipal): Promise<void> {
    await this.sessions.revokeFamilyOf(principal.sessionId, 'sign_out');
  }

  /**
   * Uses a verification link: the email is verified from now on. A used, expired, superseded or
   * unknown link is `INVALID_TOKEN`. It works for a blocked customer too: it records a fact about
   * the address, not access.
   */
  async verifyEmail(token: string): Promise<void> {
    await this.transactions.run(async () => {
      const consumed = await this.oneTimeTokens.consume({ purpose: 'verify_email', token });
      await this.customers.markEmailVerified(consumed.owner.id, this.clock.now());
    });
  }

  /**
   * "Resend the link" on the Profile and Verify email pages: a new 24-hour link, and the previous
   * one stops working. An already verified customer is sent nothing.
   */
  async resendVerification(principal: CustomerPrincipal): Promise<void> {
    await this.transactions.run(async () => {
      const row = await this.customers.findByIdForUpdate(principal.id);
      if (!row || row.deleted_at !== null) throw new AppError('UNAUTHENTICATED');
      if (row.email_verified_at !== null) return;
      await this.queueVerification(row);
    });
  }

  /**
   * "Forgot password": sends a reset link to a live, active customer with this email, and does
   * nothing otherwise. The route answers `202` either way, so the answer reveals nothing.
   *
   * The customer row is locked (`FOR NO KEY UPDATE`) and re-checked before the link is issued, as
   * every change of the account does (U15 review): an admin email change or anonymisation in
   * flight is waited for, then nothing is sent to the address it replaced; one that starts later
   * waits for this link and deletes it.
   */
  async requestPasswordReset(email: string): Promise<void> {
    await this.transactions.run(async () => {
      const found = await this.customers.findLiveByEmail(email);
      if (!found) return;
      const row = await this.customers.findByIdForUpdate(found.id);
      if (!row || row.deleted_at !== null || row.status !== 'active') return;
      if (row.email === null || row.email.toLowerCase() !== email.toLowerCase()) return;
      await this.customerService.issuePasswordReset(row.id);
    });
  }

  /**
   * Uses a reset link to set a new password (PRD "Set a new password").
   *
   * - A used, expired, superseded or unknown link is `INVALID_TOKEN`.
   * - A customer blocked since the link was sent gets `ACCOUNT_BLOCKED`; the request transaction
   *   rolls back, so the link is not spent.
   * - Success also verifies the email (the link proved control of the mailbox) and revokes every
   *   session (`password_changed`), ending any an attacker may hold. It opens no session: the
   *   customer signs in with the new password.
   */
  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const passwordHash = await this.passwords.hash(input.password);
    await this.transactions.run(async () => {
      const consumed = await this.oneTimeTokens.consume({
        purpose: 'customer_password_reset',
        token: input.token,
      });
      const row = await this.customers.findByIdForUpdate(consumed.owner.id);
      if (!row || row.deleted_at !== null) throw new AppError('INVALID_TOKEN');
      if (row.status !== 'active') throw new AppError('ACCOUNT_BLOCKED');

      const now = this.clock.now();
      await this.customers.setPasswordHash(row.id, passwordHash, now);
      await this.customers.markEmailVerified(row.id, now);
      await this.sessions.revokeAllFor({ audience: 'customer', id: row.id }, 'password_changed');
    });
  }

  /** Issues a 24-hour verification link and queues its email, in the open transaction. */
  private async queueVerification(row: CustomerRow): Promise<void> {
    if (row.email === null || row.full_name === null) {
      throw new AppError('INTERNAL', 'An anonymised customer has no email to verify.');
    }
    const issued = await this.oneTimeTokens.issue({
      purpose: 'verify_email',
      owner: { kind: 'customer', id: row.id },
      lifetimeSeconds: ONE_TIME_TOKEN_LIFETIME_SECONDS.verify_email,
    });
    await this.messaging.queue({
      template: customerVerifyEmailTemplate,
      recipient: row.email,
      params: { fullName: row.full_name, token: issued.token },
      related: { customerId: row.id },
    });
  }

  private async openSession(customerId: number): Promise<CustomerTokens> {
    const session = await this.sessions.open({
      owner: { audience: 'customer', id: customerId },
      lifetimeSeconds: SESSION_LIFETIME_SECONDS.customer,
    });
    return this.tokensFor(customerId, session.sessionId, session.refreshToken, session.expiresAt);
  }

  /**
   * Why a checked sign-in found the row changed: a new password (a change or reset) is
   * `INVALID_CREDENTIALS`, as the old password now is; a block alone is `ACCOUNT_BLOCKED`.
   */
  private async signInRefusal(checked: CustomerRow): Promise<AppError> {
    const current = await this.customers.findById(checked.id);
    const blockedOnly =
      current !== undefined &&
      current.deleted_at === null &&
      current.password_hash === checked.password_hash &&
      current.status !== 'active';
    return new AppError(blockedOnly ? 'ACCOUNT_BLOCKED' : 'INVALID_CREDENTIALS');
  }

  private async assertLive(customerId: number): Promise<void> {
    const row = await this.customers.findById(customerId);
    if (!row || row.deleted_at !== null) throw new AppError('UNAUTHENTICATED');
    if (row.status !== 'active') throw new AppError('ACCOUNT_BLOCKED');
  }

  private tokensFor(
    customerId: number,
    sessionId: number,
    refreshToken: string,
    refreshTokenExpiresAt: Date,
  ): CustomerTokens {
    const now = this.clock.now();
    return {
      customerId,
      sessionId,
      accessToken: this.accessTokens.sign({
        audience: 'customer',
        subjectId: customerId,
        sessionId,
      }),
      accessTokenExpiresAt: addToInstant(now, { seconds: ACCESS_TOKEN_TTL_SECONDS }),
      refreshToken,
      refreshTokenExpiresAt,
    };
  }
}
