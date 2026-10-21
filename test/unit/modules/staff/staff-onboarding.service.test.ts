import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { StaffPrincipal } from '../../../../src/common/auth/types';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { AppError } from '../../../../src/common/errors/app-error';
import type { OneTimeTokenService } from '../../../../src/modules/auth/one-time-token.service';
import type { PasswordService } from '../../../../src/modules/auth/password.service';
import type { SessionService } from '../../../../src/modules/auth/session.service';
import type { LiveOneTimeToken } from '../../../../src/modules/auth/types';
import type { MessageTemplateRegistry } from '../../../../src/modules/messaging/message-template.registry';
import type { MessagingService } from '../../../../src/modules/messaging/messaging.service';
import { StaffOnboardingService } from '../../../../src/modules/staff/staff-onboarding.service';
import type { StaffRepository } from '../../../../src/modules/staff/staff.repository';
import { staffInviteTemplate } from '../../../../src/modules/staff/templates/staff-invite.template';
import { staffPasswordResetTemplate } from '../../../../src/modules/staff/templates/staff-password-reset.template';
import type { StaffUserRow } from '../../../../src/modules/staff/types';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-20T10:00:00Z');
const ACTOR: StaffPrincipal = { kind: 'staff', id: 1, sessionId: 10, role: 'admin' };
const TOKEN = 'q3VbI2vT0xSx5n2b7i1d9mJ8kQe4zW6yR0tP5uL3aGc';
const NEW_HASH = 'scrypt$16384$8$5$bmV3$aGFzaA';

function member(overrides: Partial<StaffUserRow> = {}): StaffUserRow {
  return {
    id: 7,
    email: 'mona@maqady.example',
    full_name: 'Mona Adel',
    role: 'box_office',
    status: 'invited',
    password_hash: null,
    last_sign_in_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function live(purpose: LiveOneTimeToken['purpose'], ownerId = 7): LiveOneTimeToken {
  const kind =
    purpose === 'staff_invite' || purpose === 'staff_password_reset' ? 'staff' : 'customer';
  return { id: 30, purpose, owner: { kind, id: ownerId } };
}

describe('StaffOnboardingService', () => {
  let staff: jest.Mocked<StaffRepository>;
  let passwords: jest.Mocked<PasswordService>;
  let sessions: jest.Mocked<SessionService>;
  let oneTimeTokens: jest.Mocked<OneTimeTokenService>;
  let messaging: jest.Mocked<MessagingService>;
  let registry: jest.Mocked<MessageTemplateRegistry>;
  let audit: jest.Mocked<AuditService>;
  let service: StaffOnboardingService;

  beforeEach(() => {
    staff = {
      insert: jest.fn((row: Omit<StaffUserRow, 'id' | 'last_sign_in_at'>) =>
        Promise.resolve(member({ ...row, id: 7 })),
      ),
      findByEmail: jest.fn().mockResolvedValue(member({ status: 'active', password_hash: 'x' })),
      findByIdForUpdate: jest.fn().mockResolvedValue(member()),
      setPassword: jest.fn((id: number, changes: Partial<StaffUserRow>) =>
        Promise.resolve(member({ id, ...changes })),
      ),
    } as unknown as jest.Mocked<StaffRepository>;
    passwords = {
      hash: jest.fn().mockResolvedValue(NEW_HASH),
    } as unknown as jest.Mocked<PasswordService>;
    sessions = {
      revokeAllFor: jest.fn().mockResolvedValue(2),
    } as unknown as jest.Mocked<SessionService>;
    oneTimeTokens = {
      issue: jest.fn().mockResolvedValue({
        id: 30,
        token: TOKEN,
        expiresAt: new Date('2026-10-23T10:00:00Z'),
      }),
      findLive: jest.fn().mockResolvedValue(live('staff_invite')),
      consume: jest.fn().mockResolvedValue({ id: 30, owner: { kind: 'staff', id: 7 } }),
    } as unknown as jest.Mocked<OneTimeTokenService>;
    messaging = {
      queue: jest.fn().mockResolvedValue({ id: 99 }),
    } as unknown as jest.Mocked<MessagingService>;
    registry = { register: jest.fn() } as unknown as jest.Mocked<MessageTemplateRegistry>;
    audit = { record: jest.fn().mockResolvedValue(1) } as unknown as jest.Mocked<AuditService>;
    const transactions = {
      run: jest.fn((fn: () => Promise<unknown>) => fn()),
    } as unknown as TransactionRepository;
    service = new StaffOnboardingService(
      staff,
      passwords,
      sessions,
      oneTimeTokens,
      messaging,
      registry,
      transactions,
      audit,
      new TestClock(NOW),
    );
  });

  it('registers both staff email templates at boot', () => {
    service.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(staffInviteTemplate);
    expect(registry.register).toHaveBeenCalledWith(staffPasswordResetTemplate);
  });

  describe('invite', () => {
    it('creates an invited member without a password, issues a 72-hour token and queues the email', async () => {
      const invited = await service.invite(ACTOR, {
        email: '  mona@maqady.example ',
        fullName: ' Mona Adel ',
        role: 'box_office',
      });

      expect(staff.insert).toHaveBeenCalledWith({
        email: 'mona@maqady.example',
        full_name: 'Mona Adel',
        role: 'box_office',
        status: 'invited',
        password_hash: null,
        created_at: NOW,
        updated_at: NOW,
      });
      expect(oneTimeTokens.issue).toHaveBeenCalledWith({
        purpose: 'staff_invite',
        owner: { kind: 'staff', id: 7 },
        lifetimeSeconds: 72 * 3600,
      });
      expect(messaging.queue).toHaveBeenCalledWith({
        template: staffInviteTemplate,
        recipient: 'mona@maqady.example',
        params: { fullName: 'Mona Adel', role: 'box_office', token: TOKEN },
        related: { staffUserId: 7 },
      });
      expect(audit.record).toHaveBeenCalledWith({
        actor: { kind: 'staff', id: 1 },
        action: 'staff_user.invited',
        entity: { type: 'staff_user', id: 7 },
        metadata: { role: 'box_office', status: 'invited' },
      });
      expect(invited).toMatchObject({ id: 7, status: 'invited', hasPassword: false });
    });

    it('answers EMAIL_TAKEN and issues and sends nothing when the email is in use', async () => {
      staff.insert.mockResolvedValueOnce(undefined);
      await expect(
        service.invite(ACTOR, { email: 'mona@maqady.example', fullName: 'M', role: 'admin' }),
      ).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
      expect(oneTimeTokens.issue).not.toHaveBeenCalled();
      expect(messaging.queue).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('resendInvite', () => {
    it('locks the member, issues a new invite token (voiding the old one) and queues the email', async () => {
      const invitation = await service.resendInvite(ACTOR, 7);

      expect(staff.findByIdForUpdate).toHaveBeenCalledWith(7);
      expect(staff.findByIdForUpdate.mock.invocationCallOrder[0]).toBeLessThan(
        oneTimeTokens.issue.mock.invocationCallOrder[0]!,
      );
      expect(oneTimeTokens.issue).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'staff_invite', owner: { kind: 'staff', id: 7 } }),
      );
      expect(messaging.queue).toHaveBeenCalledWith(
        expect.objectContaining({
          template: staffInviteTemplate,
          recipient: 'mona@maqady.example',
        }),
      );
      expect(audit.record).toHaveBeenCalledWith({
        actor: { kind: 'staff', id: 1 },
        action: 'staff_user.invite_resent',
        entity: { type: 'staff_user', id: 7 },
      });
      expect(invitation).toEqual({ staffUserId: 7, expiresAt: new Date('2026-10-23T10:00:00Z') });
    });

    it('answers NOT_FOUND for an unknown member', async () => {
      staff.findByIdForUpdate.mockResolvedValueOnce(undefined);
      await expect(service.resendInvite(ACTOR, 404)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(oneTimeTokens.issue).not.toHaveBeenCalled();
    });

    it.each(['active', 'deactivated'] as const)(
      'answers NOT_INVITED with the status for a %s member, and sends nothing',
      async (status) => {
        staff.findByIdForUpdate.mockResolvedValueOnce(member({ status, password_hash: 'x' }));
        const error = await service.resendInvite(ACTOR, 7).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(AppError);
        expect(error).toMatchObject({ code: 'NOT_INVITED', details: { status } });
        expect(oneTimeTokens.issue).not.toHaveBeenCalled();
        expect(messaging.queue).not.toHaveBeenCalled();
      },
    );
  });

  describe('requestPasswordReset', () => {
    it('emails an active member a 1-hour reset link, after locking them, and records it as the system', async () => {
      staff.findByIdForUpdate.mockResolvedValueOnce(
        member({ status: 'active', password_hash: 'x' }),
      );
      await service.requestPasswordReset(' Mona@Maqady.example ');

      expect(staff.findByEmail).toHaveBeenCalledWith('Mona@Maqady.example');
      expect(staff.findByIdForUpdate.mock.invocationCallOrder[0]).toBeLessThan(
        oneTimeTokens.issue.mock.invocationCallOrder[0]!,
      );
      expect(oneTimeTokens.issue).toHaveBeenCalledWith({
        purpose: 'staff_password_reset',
        owner: { kind: 'staff', id: 7 },
        lifetimeSeconds: 3600,
      });
      expect(messaging.queue).toHaveBeenCalledWith({
        template: staffPasswordResetTemplate,
        recipient: 'mona@maqady.example',
        params: { fullName: 'Mona Adel', token: TOKEN },
        related: { staffUserId: 7 },
      });
      expect(audit.record).toHaveBeenCalledWith({
        actor: { kind: 'system' },
        action: 'staff_user.password_reset_requested',
        entity: { type: 'staff_user', id: 7 },
      });
    });

    it('sends nothing for an unknown email', async () => {
      staff.findByEmail.mockResolvedValueOnce(undefined);
      await expect(service.requestPasswordReset('nobody@maqady.example')).resolves.toBeUndefined();
      expect(oneTimeTokens.issue).not.toHaveBeenCalled();
      expect(messaging.queue).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it.each(['invited', 'deactivated'] as const)(
      'sends nothing to a %s member (as seen under the lock)',
      async (status) => {
        staff.findByIdForUpdate.mockResolvedValueOnce(member({ status }));
        await expect(service.requestPasswordReset('mona@maqady.example')).resolves.toBeUndefined();
        expect(oneTimeTokens.issue).not.toHaveBeenCalled();
        expect(messaging.queue).not.toHaveBeenCalled();
      },
    );
  });

  describe('setPassword', () => {
    it('with an invite: locks the member before using the token, sets the password and activates them', async () => {
      await service.setPassword({ token: TOKEN, password: 'Cinema2026' });

      expect(oneTimeTokens.findLive).toHaveBeenCalledWith(TOKEN);
      expect(staff.findByIdForUpdate).toHaveBeenCalledWith(7);
      expect(staff.findByIdForUpdate.mock.invocationCallOrder[0]).toBeLessThan(
        oneTimeTokens.consume.mock.invocationCallOrder[0]!,
      );
      expect(oneTimeTokens.consume).toHaveBeenCalledWith({ purpose: 'staff_invite', token: TOKEN });
      expect(passwords.hash).toHaveBeenCalledWith('Cinema2026');
      expect(staff.setPassword).toHaveBeenCalledWith(7, {
        password_hash: NEW_HASH,
        status: 'active',
        updated_at: NOW,
      });
      expect(sessions.revokeAllFor).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith({
        actor: { kind: 'staff', id: 7 },
        action: 'staff_user.password_set',
        entity: { type: 'staff_user', id: 7 },
        changedFields: ['password', 'status'],
        metadata: { purpose: 'staff_invite' },
      });
    });

    it('with a reset: replaces an active member’s password and revokes their sessions', async () => {
      oneTimeTokens.findLive.mockResolvedValueOnce(live('staff_password_reset'));
      staff.findByIdForUpdate.mockResolvedValueOnce(
        member({ status: 'active', password_hash: 'x' }),
      );

      await service.setPassword({ token: TOKEN, password: 'Cinema2026' });

      expect(oneTimeTokens.consume).toHaveBeenCalledWith({
        purpose: 'staff_password_reset',
        token: TOKEN,
      });
      expect(staff.setPassword).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ status: 'active' }),
      );
      expect(sessions.revokeAllFor).toHaveBeenCalledWith(
        { audience: 'staff', id: 7 },
        'password_changed',
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          changedFields: ['password'],
          metadata: { purpose: 'staff_password_reset' },
        }),
      );
    });

    it.each([
      ['an unknown, used or expired token', null],
      ['a customer verification token', live('verify_email', 9)],
      ['a customer reset token', live('customer_password_reset', 9)],
    ])('answers INVALID_TOKEN for %s, before hashing or locking anything', async (_name, found) => {
      oneTimeTokens.findLive.mockResolvedValueOnce(found);
      await expect(
        service.setPassword({ token: TOKEN, password: 'Cinema2026' }),
      ).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
      expect(passwords.hash).not.toHaveBeenCalled();
      expect(staff.findByIdForUpdate).not.toHaveBeenCalled();
      expect(oneTimeTokens.consume).not.toHaveBeenCalled();
    });

    it('answers INVALID_TOKEN when the token was used or deleted after it was found', async () => {
      oneTimeTokens.consume.mockRejectedValueOnce(new AppError('INVALID_TOKEN'));
      await expect(
        service.setPassword({ token: TOKEN, password: 'Cinema2026' }),
      ).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
      expect(staff.setPassword).not.toHaveBeenCalled();
    });

    it.each([
      ['an invite', 'staff_invite', 'active', 'INVALID_TOKEN'],
      ['an invite', 'staff_invite', 'deactivated', 'ACCOUNT_DEACTIVATED'],
      ['a reset', 'staff_password_reset', 'invited', 'INVALID_TOKEN'],
      ['a reset', 'staff_password_reset', 'deactivated', 'ACCOUNT_DEACTIVATED'],
    ] as const)(
      'refuses %s for a member who is %s with %s, changing nothing',
      async (_name, purpose, status, code) => {
        oneTimeTokens.findLive.mockResolvedValueOnce(live(purpose));
        staff.findByIdForUpdate.mockResolvedValueOnce(member({ status, password_hash: 'x' }));
        await expect(
          service.setPassword({ token: TOKEN, password: 'Cinema2026' }),
        ).rejects.toMatchObject({ code });
        expect(staff.setPassword).not.toHaveBeenCalled();
        expect(sessions.revokeAllFor).not.toHaveBeenCalled();
        expect(audit.record).not.toHaveBeenCalled();
      },
    );

    it('answers INVALID_TOKEN when the member is gone', async () => {
      staff.findByIdForUpdate.mockResolvedValueOnce(undefined);
      await expect(
        service.setPassword({ token: TOKEN, password: 'Cinema2026' }),
      ).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
      expect(oneTimeTokens.consume).not.toHaveBeenCalled();
    });
  });
});
