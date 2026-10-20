import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { AccessTokenService } from '../../common/auth/access-token.service';
import { ACCESS_TOKEN_TTL_SECONDS } from '../../common/auth/auth.constants';
import type { StaffPrincipal } from '../../common/auth/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { addToInstant } from '../../common/time/time';
import { SESSION_LIFETIME_SECONDS } from '../auth/auth.constants';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import { toStaffMember } from './staff-member.mapper';
import { StaffRepository } from './staff.repository';
import type { StaffMember, StaffSignInInput, StaffSignInResult, StaffTokens } from './types';

/**
 * Staff sign-in, refresh and sign-out (design §10.2, §11 "Admin routes"), on the shared
 * `SessionService` with the staff lifetime of 12 hours.
 */
@Injectable()
export class StaffAuthService {
  constructor(
    private readonly staff: StaffRepository,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly accessTokens: AccessTokenService,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /**
   * Checks the email and password and opens a session.
   *
   * - A wrong password, an unknown email and a member without a password are all
   *   `INVALID_CREDENTIALS`, after the same scrypt work, so neither the answer nor its timing tells
   *   whether the email exists.
   * - A member who is not active gets `ACCOUNT_DEACTIVATED`, but only once the password matched.
   * - The sign-in is recorded first, by an update that matches only an active member. It waits for
   *   a deactivation in flight and then sees its result, so a session never opens for a member who
   *   was deactivated in the meantime (and would come back to life on reactivation).
   */
  async signIn(input: StaffSignInInput): Promise<StaffSignInResult> {
    return this.transactions.run(async () => {
      const row = await this.staff.findByEmail(input.email.trim());
      const matches = await this.passwords.verify(input.password, row?.password_hash ?? null);
      if (!row || !matches) throw new AppError('INVALID_CREDENTIALS');
      if (row.status !== 'active') throw new AppError('ACCOUNT_DEACTIVATED');

      const signedIn = await this.staff.recordSignIn(row.id, this.clock.now());
      if (!signedIn) throw new AppError('ACCOUNT_DEACTIVATED');
      const session = await this.sessions.open({
        owner: { audience: 'staff', id: row.id },
        lifetimeSeconds: SESSION_LIFETIME_SECONDS.staff,
      });
      await this.audit.record({
        actor: { kind: 'staff', id: row.id },
        action: 'session.created',
        entity: { type: 'session', id: session.sessionId },
        metadata: { audience: 'staff' },
      });
      return {
        member: toStaffMember(signedIn),
        tokens: this.tokensFor(row.id, session.sessionId, session.refreshToken, session.expiresAt),
      };
    });
  }

  /**
   * Rotates a refresh token (see `SessionService.refresh`); a member who is no longer active gets
   * `ACCOUNT_DEACTIVATED` and keeps the old token. Runs outside the request transaction.
   */
  async refresh(refreshToken: string): Promise<StaffTokens> {
    const session = await this.sessions.refresh({
      audience: 'staff',
      refreshToken,
      assertOwnerLive: (staffUserId) => this.assertActive(staffUserId),
    });
    return this.tokensFor(
      session.ownerId,
      session.sessionId,
      session.refreshToken,
      session.expiresAt,
    );
  }

  /** Ends the caller's session family; its access and refresh tokens stop working at once. */
  async signOut(principal: StaffPrincipal): Promise<void> {
    await this.transactions.run(async () => {
      await this.sessions.revokeFamilyOf(principal.sessionId, 'sign_out');
      await this.audit.record({
        actor: { kind: 'staff', id: principal.id },
        action: 'session.revoked',
        entity: { type: 'session', id: principal.sessionId },
        metadata: { reason: 'sign_out' },
      });
    });
  }

  /** The signed-in member, for `GET /admin/me`. */
  async profile(principal: StaffPrincipal): Promise<StaffMember> {
    const row = await this.staff.findById(principal.id);
    if (!row) throw new AppError('UNAUTHENTICATED');
    return toStaffMember(row);
  }

  private async assertActive(staffUserId: number): Promise<void> {
    const row = await this.staff.findById(staffUserId);
    if (!row) throw new AppError('UNAUTHENTICATED');
    if (row.status !== 'active') throw new AppError('ACCOUNT_DEACTIVATED');
  }

  private tokensFor(
    staffUserId: number,
    sessionId: number,
    refreshToken: string,
    refreshTokenExpiresAt: Date,
  ): StaffTokens {
    const now = this.clock.now();
    return {
      staffUserId,
      sessionId,
      accessToken: this.accessTokens.sign({ audience: 'staff', subjectId: staffUserId, sessionId }),
      accessTokenExpiresAt: addToInstant(now, { seconds: ACCESS_TOKEN_TTL_SECONDS }),
      refreshToken,
      refreshTokenExpiresAt,
    };
  }
}
