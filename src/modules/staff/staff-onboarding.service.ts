import { Injectable, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { StaffPrincipal } from '../../common/auth/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { ONE_TIME_TOKEN_LIFETIME_SECONDS } from '../auth/auth.constants';
import { OneTimeTokenService } from '../auth/one-time-token.service';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import { MessageTemplateRegistry } from '../messaging/message-template.registry';
import { MessagingService } from '../messaging/messaging.service';
import { PASSWORD_SETUP_PURPOSES } from './enums';
import { toStaffMember } from './staff-member.mapper';
import { StaffRepository } from './staff.repository';
import { staffInviteTemplate } from './templates/staff-invite.template';
import { staffPasswordResetTemplate } from './templates/staff-password-reset.template';
import type {
  InviteStaffInput,
  PasswordSetupInput,
  PasswordSetupPurpose,
  StaffInvitation,
  StaffMember,
  StaffUserRow,
} from './types';

/**
 * How staff get and recover a password (design §10.1, §10.5; PRD "Staff", "Set your password"):
 * invites and their resends, "Forgot password" requests, and the set-password page that takes
 * either link. It owns the `staff.invite` and `staff.password_reset` emails and registers them.
 *
 * Every method joins the request transaction, so the member, the one-time token, the queued
 * email and the audit event commit or roll back together. Locks follow the staff order of
 * design §10.1: the member's row first, then their tokens and sessions.
 */
@Injectable()
export class StaffOnboardingService implements OnModuleInit {
  constructor(
    private readonly staff: StaffRepository,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly oneTimeTokens: OneTimeTokenService,
    private readonly messaging: MessagingService,
    private readonly templates: MessageTemplateRegistry,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.templates.register(staffInviteTemplate);
    this.templates.register(staffPasswordResetTemplate);
  }

  /**
   * Creates an invited member (no password) and emails them a 72-hour set-password link. An
   * email already used by any member, in any letter case and status, is `EMAIL_TAKEN`.
   */
  async invite(actor: StaffPrincipal, input: InviteStaffInput): Promise<StaffMember> {
    return this.transactions.run(async () => {
      const now = this.clock.now();
      const row = await this.staff.insert({
        email: input.email.trim(),
        full_name: input.fullName.trim(),
        role: input.role,
        status: 'invited',
        password_hash: null,
        created_at: now,
        updated_at: now,
      });
      if (!row) throw new AppError('EMAIL_TAKEN');
      await this.sendInvite(row);
      await this.audit.record({
        actor: { kind: 'staff', id: actor.id },
        action: 'staff_user.invited',
        entity: { type: 'staff_user', id: row.id },
        metadata: { role: row.role, status: row.status },
      });
      return toStaffMember(row);
    });
  }

  /**
   * Emails an invited member a new link; the previous one stops working. Only a member who is
   * still `invited` can get one (`NOT_INVITED` otherwise).
   */
  async resendInvite(actor: StaffPrincipal, staffUserId: number): Promise<StaffInvitation> {
    return this.transactions.run(async () => {
      const row = await this.staff.findByIdForUpdate(staffUserId);
      if (!row) throw new AppError('NOT_FOUND');
      if (row.status !== 'invited') {
        throw new AppError('NOT_INVITED', undefined, { status: row.status });
      }
      const expiresAt = await this.sendInvite(row);
      await this.audit.record({
        actor: { kind: 'staff', id: actor.id },
        action: 'staff_user.invite_resent',
        entity: { type: 'staff_user', id: row.id },
      });
      return { staffUserId: row.id, expiresAt };
    });
  }

  /**
   * "Forgot password": emails an active member a 1-hour reset link; the previous one stops
   * working. Unknown, invited and deactivated emails get nothing, and the caller answers the
   * same either way, so the route reveals nothing.
   */
  async requestPasswordReset(email: string): Promise<void> {
    await this.transactions.run(async () => {
      const found = await this.staff.findByEmail(email.trim());
      if (!found) return;
      const row = await this.staff.findByIdForUpdate(found.id);
      if (row?.status !== 'active') return;

      const issued = await this.oneTimeTokens.issue({
        purpose: 'staff_password_reset',
        owner: { kind: 'staff', id: row.id },
        lifetimeSeconds: ONE_TIME_TOKEN_LIFETIME_SECONDS.staff_password_reset,
      });
      await this.messaging.queue({
        template: staffPasswordResetTemplate,
        recipient: row.email,
        params: { fullName: row.full_name, token: issued.token },
        related: { staffUserId: row.id },
      });
      await this.audit.record({
        actor: { kind: 'system' },
        action: 'staff_user.password_reset_requested',
        entity: { type: 'staff_user', id: row.id },
      });
    });
  }

  /**
   * The set-password page: an invite link turns an invited member active with this password; a
   * reset link replaces an active member's password and signs them out everywhere. Either link
   * works once. No session is opened: the member signs in next.
   *
   * - A link that is unknown, used, expired or not a staff link is `INVALID_TOKEN`.
   * - The token is read first without a lock, then the member is locked, then the token is used,
   *   so a setup takes its locks in the same order as a deactivation (member, then tokens) and the
   *   two can't deadlock. A token used or deleted in between fails to be used: `INVALID_TOKEN`.
   * - A deactivated member is `ACCOUNT_DEACTIVATED`; an invite for a member who is no longer
   *   invited, or a reset for one who never was active, is `INVALID_TOKEN`. Every refusal rolls
   *   back, so the link is not spent.
   */
  async setPassword(input: PasswordSetupInput): Promise<void> {
    await this.transactions.run(async () => {
      const live = await this.oneTimeTokens.findLive(input.token);
      if (!live || live.owner.kind !== 'staff' || !isPasswordSetupPurpose(live.purpose)) {
        throw new AppError('INVALID_TOKEN');
      }
      const purpose = live.purpose;
      // Hashed before the member is locked, so the lock is held only for the writes.
      const passwordHash = await this.passwords.hash(input.password);

      const row = await this.staff.findByIdForUpdate(live.owner.id);
      if (!row) throw new AppError('INVALID_TOKEN');
      await this.oneTimeTokens.consume({ purpose, token: input.token });
      assertMaySetPassword(row, purpose);

      await this.staff.setPassword(row.id, {
        password_hash: passwordHash,
        status: 'active',
        updated_at: this.clock.now(),
      });
      if (purpose === 'staff_password_reset') {
        await this.sessions.revokeAllFor({ audience: 'staff', id: row.id }, 'password_changed');
      }
      await this.audit.record({
        actor: { kind: 'staff', id: row.id },
        action: 'staff_user.password_set',
        entity: { type: 'staff_user', id: row.id },
        changedFields: purpose === 'staff_invite' ? ['password', 'status'] : ['password'],
        metadata: { purpose },
      });
    });
  }

  /** Issues a 72-hour invite token (voiding the previous one) and queues the email. */
  private async sendInvite(row: StaffUserRow): Promise<Date> {
    const issued = await this.oneTimeTokens.issue({
      purpose: 'staff_invite',
      owner: { kind: 'staff', id: row.id },
      lifetimeSeconds: ONE_TIME_TOKEN_LIFETIME_SECONDS.staff_invite,
    });
    await this.messaging.queue({
      template: staffInviteTemplate,
      recipient: row.email,
      params: { fullName: row.full_name, role: row.role, token: issued.token },
      related: { staffUserId: row.id },
    });
    return issued.expiresAt;
  }
}

function isPasswordSetupPurpose(purpose: string): purpose is PasswordSetupPurpose {
  return (PASSWORD_SETUP_PURPOSES as readonly string[]).includes(purpose);
}

/** The status rules of a password setup (see `setPassword`). */
function assertMaySetPassword(row: StaffUserRow, purpose: PasswordSetupPurpose): void {
  if (row.status === 'deactivated') throw new AppError('ACCOUNT_DEACTIVATED');
  const expected = purpose === 'staff_invite' ? 'invited' : 'active';
  if (row.status !== expected) throw new AppError('INVALID_TOKEN');
}
