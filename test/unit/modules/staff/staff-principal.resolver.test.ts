import type { PrincipalResolverRegistry } from '../../../../src/common/auth/principal-resolver.registry';
import { StaffPrincipalResolver } from '../../../../src/modules/staff/staff-principal.resolver';
import type { StaffRepository } from '../../../../src/modules/staff/staff.repository';
import type { StaffPrincipalRow } from '../../../../src/modules/staff/types';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-20T10:00:00Z');
const TOKEN = { audience: 'staff', subjectId: 3, sessionId: 30 } as const;

function row(overrides: Partial<StaffPrincipalRow> = {}): StaffPrincipalRow {
  return {
    staff_user_id: 3,
    revoked_at: null,
    expires_at: new Date('2026-10-20T12:00:00Z'),
    role: 'admin',
    status: 'active',
    ...overrides,
  };
}

describe('StaffPrincipalResolver', () => {
  let staff: jest.Mocked<StaffRepository>;
  let registry: jest.Mocked<PrincipalResolverRegistry>;
  let resolver: StaffPrincipalResolver;

  beforeEach(() => {
    staff = {
      findPrincipalBySession: jest.fn().mockResolvedValue(row()),
    } as unknown as jest.Mocked<StaffRepository>;
    registry = { register: jest.fn() } as unknown as jest.Mocked<PrincipalResolverRegistry>;
    resolver = new StaffPrincipalResolver(registry, staff, new TestClock(NOW));
  });

  it('registers itself for the staff audience', () => {
    resolver.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith('staff', resolver);
  });

  it('resolves a live session to the member, with the role read from the database', async () => {
    await expect(resolver.resolve(TOKEN)).resolves.toEqual({
      kind: 'staff',
      id: 3,
      sessionId: 30,
      role: 'admin',
    });
    expect(staff.findPrincipalBySession).toHaveBeenCalledWith(30);

    staff.findPrincipalBySession.mockResolvedValue(row({ role: 'box_office' }));
    await expect(resolver.resolve(TOKEN)).resolves.toMatchObject({ role: 'box_office' });
  });

  it('answers null for no staff session, or a session of another member', async () => {
    staff.findPrincipalBySession.mockResolvedValueOnce(undefined);
    await expect(resolver.resolve(TOKEN)).resolves.toBeNull();
    staff.findPrincipalBySession.mockResolvedValueOnce(row({ staff_user_id: 4 }));
    await expect(resolver.resolve(TOKEN)).resolves.toBeNull();
  });

  it.each(['deactivated', 'invited'] as const)(
    'answers ACCOUNT_DEACTIVATED for a %s member, even when the session is also revoked',
    async (status) => {
      staff.findPrincipalBySession.mockResolvedValue(row({ status, revoked_at: NOW }));
      await expect(resolver.resolve(TOKEN)).rejects.toMatchObject({ code: 'ACCOUNT_DEACTIVATED' });
    },
  );

  it('answers SESSION_REVOKED for a revoked session', async () => {
    staff.findPrincipalBySession.mockResolvedValue(row({ revoked_at: NOW }));
    await expect(resolver.resolve(TOKEN)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
  });

  it('answers SESSION_EXPIRED from the expiry instant on', async () => {
    staff.findPrincipalBySession.mockResolvedValue(row({ expires_at: NOW }));
    await expect(resolver.resolve(TOKEN)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });
});
