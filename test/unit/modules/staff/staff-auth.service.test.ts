import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { AccessTokenService } from '../../../../src/common/auth/access-token.service';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import type { PasswordService } from '../../../../src/modules/auth/password.service';
import type { SessionService } from '../../../../src/modules/auth/session.service';
import type { RefreshSessionInput } from '../../../../src/modules/auth/types';
import { StaffAuthService } from '../../../../src/modules/staff/staff-auth.service';
import type { StaffRepository } from '../../../../src/modules/staff/staff.repository';
import type { StaffUserRow } from '../../../../src/modules/staff/types';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-20T10:00:00Z');
const HASH = 'scrypt$16384$8$5$c2FsdA$a2V5';

function member(overrides: Partial<StaffUserRow> = {}): StaffUserRow {
  return {
    id: 3,
    email: 'mona@maqady.example',
    full_name: 'Mona Adel',
    role: 'box_office',
    status: 'active',
    password_hash: HASH,
    last_sign_in_at: null,
    created_at: new Date('2026-10-01T10:00:00Z'),
    updated_at: new Date('2026-10-01T10:00:00Z'),
    ...overrides,
  };
}

describe('StaffAuthService', () => {
  let staff: jest.Mocked<StaffRepository>;
  let passwords: jest.Mocked<PasswordService>;
  let sessions: jest.Mocked<SessionService>;
  let accessTokens: jest.Mocked<AccessTokenService>;
  let audit: jest.Mocked<AuditService>;
  let service: StaffAuthService;

  beforeEach(() => {
    staff = {
      findByEmail: jest.fn().mockResolvedValue(member()),
      findById: jest.fn().mockResolvedValue(member()),
      recordSignIn: jest.fn().mockResolvedValue(member({ last_sign_in_at: NOW, updated_at: NOW })),
    } as unknown as jest.Mocked<StaffRepository>;
    passwords = {
      verify: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<PasswordService>;
    sessions = {
      open: jest.fn().mockResolvedValue({
        sessionId: 30,
        familyId: 'f',
        refreshToken: 'r'.repeat(43),
        expiresAt: new Date('2026-10-20T22:00:00Z'),
      }),
      refresh: jest.fn().mockResolvedValue({
        sessionId: 31,
        ownerId: 3,
        refreshToken: 's'.repeat(43),
        expiresAt: new Date('2026-10-20T22:00:00Z'),
      }),
      revokeFamilyOf: jest.fn().mockResolvedValue(1),
    } as unknown as jest.Mocked<SessionService>;
    accessTokens = {
      sign: jest.fn().mockReturnValue('a.b.c'),
    } as unknown as jest.Mocked<AccessTokenService>;
    audit = { record: jest.fn().mockResolvedValue(1) } as unknown as jest.Mocked<AuditService>;
    const transactions = {
      run: jest.fn((fn: () => Promise<unknown>) => fn()),
    } as unknown as TransactionRepository;
    service = new StaffAuthService(
      staff,
      passwords,
      sessions,
      accessTokens,
      transactions,
      audit,
      new TestClock(NOW),
    );
  });

  describe('signIn', () => {
    it('opens a 12-hour staff session, records the sign-in and signs an access token', async () => {
      const result = await service.signIn({
        email: ' Mona@Maqady.example ',
        password: 'Cinema2026',
      });

      expect(staff.findByEmail).toHaveBeenCalledWith('Mona@Maqady.example');
      expect(passwords.verify).toHaveBeenCalledWith('Cinema2026', HASH);
      expect(sessions.open).toHaveBeenCalledWith({
        owner: { audience: 'staff', id: 3 },
        lifetimeSeconds: 43_200,
      });
      expect(staff.recordSignIn).toHaveBeenCalledWith(3, NOW);
      expect(accessTokens.sign).toHaveBeenCalledWith({
        audience: 'staff',
        subjectId: 3,
        sessionId: 30,
      });
      expect(audit.record).toHaveBeenCalledWith({
        actor: { kind: 'staff', id: 3 },
        action: 'session.created',
        entity: { type: 'session', id: 30 },
        metadata: { audience: 'staff' },
      });
      expect(result.tokens).toEqual({
        staffUserId: 3,
        sessionId: 30,
        accessToken: 'a.b.c',
        accessTokenExpiresAt: new Date('2026-10-20T10:15:00Z'),
        refreshToken: 'r'.repeat(43),
        refreshTokenExpiresAt: new Date('2026-10-20T22:00:00Z'),
      });
      expect(result.member).toMatchObject({ id: 3, lastSignInAt: NOW });
    });

    it('answers ACCOUNT_DEACTIVATED and opens no session when the member stopped being active before the sign-in was recorded', async () => {
      staff.recordSignIn.mockResolvedValue(undefined);
      await expect(
        service.signIn({ email: 'mona@maqady.example', password: 'Cinema2026' }),
      ).rejects.toMatchObject({ code: 'ACCOUNT_DEACTIVATED' });
      expect(sessions.open).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('verifies against the dummy hash for an unknown email, then answers INVALID_CREDENTIALS', async () => {
      staff.findByEmail.mockResolvedValue(undefined);
      passwords.verify.mockResolvedValue(false);
      await expect(
        service.signIn({ email: 'nobody@x.example', password: 'p' }),
      ).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
      expect(passwords.verify).toHaveBeenCalledWith('p', null);
      expect(sessions.open).not.toHaveBeenCalled();
    });

    it('answers INVALID_CREDENTIALS for a wrong password and for a member without a password', async () => {
      passwords.verify.mockResolvedValue(false);
      await expect(
        service.signIn({ email: 'mona@maqady.example', password: 'x' }),
      ).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });

      staff.findByEmail.mockResolvedValue(member({ status: 'invited', password_hash: null }));
      await expect(
        service.signIn({ email: 'mona@maqady.example', password: 'x' }),
      ).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
      expect(passwords.verify).toHaveBeenLastCalledWith('x', null);
    });

    it('answers ACCOUNT_DEACTIVATED only once the password matched', async () => {
      staff.findByEmail.mockResolvedValue(member({ status: 'deactivated' }));
      await expect(
        service.signIn({ email: 'mona@maqady.example', password: 'Cinema2026' }),
      ).rejects.toMatchObject({ code: 'ACCOUNT_DEACTIVATED' });

      passwords.verify.mockResolvedValue(false);
      await expect(
        service.signIn({ email: 'mona@maqady.example', password: 'wrong' }),
      ).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
      expect(sessions.open).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('rotates through SessionService for the staff audience and signs the new session', async () => {
      const tokens = await service.refresh('t'.repeat(43));
      expect(sessions.refresh).toHaveBeenCalledWith({
        audience: 'staff',
        refreshToken: 't'.repeat(43),
        assertOwnerLive: expect.any(Function),
      });
      expect(accessTokens.sign).toHaveBeenCalledWith({
        audience: 'staff',
        subjectId: 3,
        sessionId: 31,
      });
      expect(tokens).toMatchObject({ sessionId: 31, refreshToken: 's'.repeat(43) });
    });

    it('its account check refuses a member who is no longer active', async () => {
      await service.refresh('t'.repeat(43));
      const [[input]] = sessions.refresh.mock.calls as [[RefreshSessionInput]];

      await expect(input.assertOwnerLive(3)).resolves.toBeUndefined();
      staff.findById.mockResolvedValueOnce(member({ status: 'deactivated' }));
      await expect(input.assertOwnerLive(3)).rejects.toMatchObject({ code: 'ACCOUNT_DEACTIVATED' });
      staff.findById.mockResolvedValueOnce(undefined);
      await expect(input.assertOwnerLive(3)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });
  });

  it('signOut revokes the family of the current session and records it', async () => {
    await service.signOut({ kind: 'staff', id: 3, sessionId: 30, role: 'box_office' });
    expect(sessions.revokeFamilyOf).toHaveBeenCalledWith(30, 'sign_out');
    expect(audit.record).toHaveBeenCalledWith({
      actor: { kind: 'staff', id: 3 },
      action: 'session.revoked',
      entity: { type: 'session', id: 30 },
      metadata: { reason: 'sign_out' },
    });
  });
});
