import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { StaffPrincipal } from '../../../../src/common/auth/types';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import type { OneTimeTokenService } from '../../../../src/modules/auth/one-time-token.service';
import type { PasswordService } from '../../../../src/modules/auth/password.service';
import type { SessionService } from '../../../../src/modules/auth/session.service';
import type { StaffRepository } from '../../../../src/modules/staff/staff.repository';
import { StaffService } from '../../../../src/modules/staff/staff.service';
import type { StaffUserRow } from '../../../../src/modules/staff/types';
import { encodeCursor } from '../../../../src/common/pagination/cursor';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-20T10:00:00Z');
const CREATED = new Date('2026-10-01T10:00:00Z');
const ACTOR: StaffPrincipal = { kind: 'staff', id: 1, sessionId: 10, role: 'admin' };

function member(overrides: Partial<StaffUserRow> = {}): StaffUserRow {
  return {
    id: 2,
    email: 'mona@maqady.example',
    full_name: 'Mona Adel',
    role: 'admin',
    status: 'active',
    password_hash: 'scrypt$16384$8$5$c2FsdA$a2V5',
    last_sign_in_at: null,
    created_at: CREATED,
    updated_at: CREATED,
    ...overrides,
  };
}

describe('StaffService', () => {
  let staff: jest.Mocked<StaffRepository>;
  let sessions: jest.Mocked<SessionService>;
  let oneTimeTokens: jest.Mocked<OneTimeTokenService>;
  let passwords: jest.Mocked<PasswordService>;
  let audit: jest.Mocked<AuditService>;
  let service: StaffService;

  beforeEach(() => {
    staff = {
      lockActiveAdmins: jest.fn().mockResolvedValue([1, 2]),
      findByIdForUpdate: jest.fn().mockResolvedValue(member()),
      update: jest.fn((id: number, changes: Partial<StaffUserRow>) =>
        Promise.resolve(member({ id, ...changes })),
      ),
      insert: jest.fn(),
      list: jest.fn(),
      count: jest.fn(),
    } as unknown as jest.Mocked<StaffRepository>;
    sessions = {
      revokeAllFor: jest.fn().mockResolvedValue(1),
    } as unknown as jest.Mocked<SessionService>;
    oneTimeTokens = {
      invalidateAllFor: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<OneTimeTokenService>;
    passwords = {
      hash: jest.fn().mockResolvedValue('scrypt$1$1$1$c2FsdA$a2V5'),
    } as unknown as jest.Mocked<PasswordService>;
    audit = { record: jest.fn().mockResolvedValue(1) } as unknown as jest.Mocked<AuditService>;
    const transactions = {
      run: jest.fn((fn: () => Promise<unknown>) => fn()),
    } as unknown as TransactionRepository;
    service = new StaffService(
      staff,
      passwords,
      sessions,
      oneTimeTokens,
      transactions,
      audit,
      new TestClock(NOW),
    );
  });

  describe('updateMember: the last-admin rule', () => {
    it('locks every active admin before the member, so concurrent changes queue in one order', async () => {
      await service.updateMember(ACTOR, 2, { role: 'box_office' });
      expect(staff.lockActiveAdmins.mock.invocationCallOrder[0]).toBeLessThan(
        staff.findByIdForUpdate.mock.invocationCallOrder[0]!,
      );
    });

    it.each([
      [{ role: 'box_office' as const }],
      [{ status: 'deactivated' as const }],
      [{ role: 'box_office' as const, status: 'deactivated' as const }],
    ])(
      'refuses %j for the only active admin with LAST_ADMIN, changing nothing',
      async (changes) => {
        staff.lockActiveAdmins.mockResolvedValue([2]);
        await expect(service.updateMember(ACTOR, 2, changes)).rejects.toMatchObject({
          code: 'LAST_ADMIN',
        });
        expect(staff.update).not.toHaveBeenCalled();
        expect(sessions.revokeAllFor).not.toHaveBeenCalled();
        expect(audit.record).not.toHaveBeenCalled();
      },
    );

    it('lets an admin step down while another active admin remains, and signs them out', async () => {
      staff.findByIdForUpdate.mockResolvedValue(member({ id: 1 }));
      staff.lockActiveAdmins.mockResolvedValue([1, 2]);
      await expect(service.updateMember(ACTOR, 1, { role: 'box_office' })).resolves.toMatchObject({
        id: 1,
        role: 'box_office',
      });
      expect(sessions.revokeAllFor).toHaveBeenCalledWith(
        { audience: 'staff', id: 1 },
        'role_changed',
      );
    });

    it('does not apply to members who are not active admins', async () => {
      staff.lockActiveAdmins.mockResolvedValue([1]);
      staff.findByIdForUpdate.mockResolvedValue(member({ role: 'box_office' }));
      await expect(
        service.updateMember(ACTOR, 2, { status: 'deactivated' }),
      ).resolves.toMatchObject({
        status: 'deactivated',
      });
    });
  });

  it('demoting writes the change, revokes the sessions as role_changed and audits the field name', async () => {
    const result = await service.updateMember(ACTOR, 2, { role: 'box_office' });

    expect(staff.update).toHaveBeenCalledWith(2, {
      role: 'box_office',
      status: 'active',
      updated_at: NOW,
    });
    expect(sessions.revokeAllFor).toHaveBeenCalledWith(
      { audience: 'staff', id: 2 },
      'role_changed',
    );
    expect(oneTimeTokens.invalidateAllFor).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith({
      actor: { kind: 'staff', id: 1 },
      action: 'staff_user.updated',
      entity: { type: 'staff_user', id: 2 },
      changedFields: ['role'],
      metadata: { role: 'box_office', status: 'active' },
    });
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).toMatchObject({ id: 2, role: 'box_office', hasPassword: true });
  });

  it('deactivating revokes every session and every unused link of the member', async () => {
    staff.findByIdForUpdate.mockResolvedValue(member({ role: 'box_office' }));
    await service.updateMember(ACTOR, 2, { status: 'deactivated' });
    expect(sessions.revokeAllFor).toHaveBeenCalledWith(
      { audience: 'staff', id: 2 },
      'account_deactivated',
    );
    expect(oneTimeTokens.invalidateAllFor).toHaveBeenCalledWith({ kind: 'staff', id: 2 });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ changedFields: ['status'] }),
    );
  });

  it('promoting revokes nothing', async () => {
    staff.findByIdForUpdate.mockResolvedValue(member({ role: 'box_office' }));
    await service.updateMember(ACTOR, 2, { role: 'admin' });
    expect(sessions.revokeAllFor).not.toHaveBeenCalled();
  });

  it('a change to the current values writes, revokes and audits nothing', async () => {
    await expect(
      service.updateMember(ACTOR, 2, { role: 'admin', status: 'active' }),
    ).resolves.toMatchObject({ id: 2, role: 'admin', status: 'active' });
    expect(staff.update).not.toHaveBeenCalled();
    expect(sessions.revokeAllFor).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('answers NOT_FOUND for an unknown member', async () => {
    staff.findByIdForUpdate.mockResolvedValue(undefined);
    await expect(service.updateMember(ACTOR, 99, { role: 'admin' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  describe('reactivation', () => {
    it('returns a deactivated member with a password to active, revoking nothing', async () => {
      staff.findByIdForUpdate.mockResolvedValue(
        member({ role: 'box_office', status: 'deactivated' }),
      );
      await expect(service.updateMember(ACTOR, 2, { status: 'active' })).resolves.toMatchObject({
        status: 'active',
      });
      expect(sessions.revokeAllFor).not.toHaveBeenCalled();
    });

    it('returns a deactivated member who never set a password to invited', async () => {
      staff.findByIdForUpdate.mockResolvedValue(
        member({ role: 'box_office', status: 'deactivated', password_hash: null }),
      );
      await expect(service.updateMember(ACTOR, 2, { status: 'active' })).resolves.toMatchObject({
        status: 'invited',
      });
      expect(staff.update).toHaveBeenCalledWith(2, expect.objectContaining({ status: 'invited' }));
    });

    it('refuses active for an invited member with VALIDATION_FAILED on status', async () => {
      staff.findByIdForUpdate.mockResolvedValue(
        member({ role: 'box_office', status: 'invited', password_hash: null }),
      );
      await expect(service.updateMember(ACTOR, 2, { status: 'active' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { fields: [{ field: 'status', messages: [expect.any(String)] }] },
      });
      expect(staff.update).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('pages by full name and id, with a cursor from the last row of the page', async () => {
      staff.list.mockResolvedValue([
        member({ id: 2, full_name: 'Amr' }),
        member({ id: 5, full_name: 'Badr' }),
        member({ id: 3 }),
      ]);
      staff.count.mockResolvedValue(7);
      const page = await service.list({ role: 'admin' }, { after: null, limit: 2 });
      expect(staff.list).toHaveBeenCalledWith({ role: 'admin' }, { after: null, limit: 2 });
      expect(page.items.map((item) => item.id)).toEqual([2, 5]);
      expect(page.nextCursor).toBe(encodeCursor({ sortKey: 'Badr', id: 5 }));
      expect(page.total).toBe(7);
    });

    it('refuses a cursor whose sort key is not a name', async () => {
      await expect(
        service.list({}, { after: { sortKey: null, id: 3 }, limit: 2 }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(staff.list).not.toHaveBeenCalled();
    });
  });

  it('creates an active member with a hashed password, or answers EMAIL_TAKEN', async () => {
    staff.insert.mockResolvedValueOnce(member({ id: 8, role: 'box_office' }));
    await expect(
      service.createActiveMember({
        email: ' mona@maqady.example ',
        fullName: ' Mona Adel ',
        role: 'box_office',
        password: 'Cinema2026',
      }),
    ).resolves.toMatchObject({ id: 8, status: 'active' });
    expect(passwords.hash).toHaveBeenCalledWith('Cinema2026');
    expect(staff.insert).toHaveBeenCalledWith({
      email: 'mona@maqady.example',
      full_name: 'Mona Adel',
      role: 'box_office',
      status: 'active',
      password_hash: 'scrypt$1$1$1$c2FsdA$a2V5',
      created_at: NOW,
      updated_at: NOW,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actor: { kind: 'system' }, action: 'staff_user.created' }),
    );

    staff.insert.mockResolvedValueOnce(undefined);
    await expect(
      service.createActiveMember({
        email: 'mona@maqady.example',
        fullName: 'Mona',
        role: 'admin',
        password: 'Cinema2026',
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
  });
});
