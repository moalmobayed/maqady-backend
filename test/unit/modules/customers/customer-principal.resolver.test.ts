import type { PrincipalResolverRegistry } from '../../../../src/common/auth/principal-resolver.registry';
import { CustomerPrincipalResolver } from '../../../../src/modules/customers/customer-principal.resolver';
import type { CustomersRepository } from '../../../../src/modules/customers/customers.repository';
import type { CustomerPrincipalRow } from '../../../../src/modules/customers/types';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-20T10:00:00Z');
const TOKEN = { audience: 'customer', subjectId: 7, sessionId: 70 } as const;

function row(overrides: Partial<CustomerPrincipalRow> = {}): CustomerPrincipalRow {
  return {
    customer_id: 7,
    revoked_at: null,
    expires_at: new Date('2026-11-19T10:00:00Z'),
    status: 'active',
    deleted_at: null,
    ...overrides,
  };
}

describe('CustomerPrincipalResolver', () => {
  let customers: jest.Mocked<CustomersRepository>;
  let registry: jest.Mocked<PrincipalResolverRegistry>;
  let resolver: CustomerPrincipalResolver;

  beforeEach(() => {
    customers = {
      findPrincipalBySession: jest.fn().mockResolvedValue(row()),
    } as unknown as jest.Mocked<CustomersRepository>;
    registry = { register: jest.fn() } as unknown as jest.Mocked<PrincipalResolverRegistry>;
    resolver = new CustomerPrincipalResolver(registry, customers, new TestClock(NOW));
  });

  it('registers itself for the customer audience', () => {
    resolver.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith('customer', resolver);
  });

  it('resolves a live session to the customer, reading the session by its id', async () => {
    await expect(resolver.resolve(TOKEN)).resolves.toEqual({
      kind: 'customer',
      id: 7,
      sessionId: 70,
    });
    expect(customers.findPrincipalBySession).toHaveBeenCalledWith(70);
  });

  it('answers null for no session, another customer’s session and an anonymised customer', async () => {
    customers.findPrincipalBySession.mockResolvedValueOnce(undefined);
    await expect(resolver.resolve(TOKEN)).resolves.toBeNull();
    customers.findPrincipalBySession.mockResolvedValueOnce(row({ customer_id: 8 }));
    await expect(resolver.resolve(TOKEN)).resolves.toBeNull();
    customers.findPrincipalBySession.mockResolvedValueOnce(row({ deleted_at: NOW }));
    await expect(resolver.resolve(TOKEN)).resolves.toBeNull();
  });

  it('answers ACCOUNT_BLOCKED for a blocked customer, before the session checks', async () => {
    customers.findPrincipalBySession.mockResolvedValue(
      row({ status: 'blocked', revoked_at: NOW, expires_at: NOW }),
    );
    await expect(resolver.resolve(TOKEN)).rejects.toMatchObject({ code: 'ACCOUNT_BLOCKED' });
  });

  it('answers SESSION_REVOKED for a revoked session, even one also past its expiry', async () => {
    customers.findPrincipalBySession.mockResolvedValue(row({ revoked_at: NOW, expires_at: NOW }));
    await expect(resolver.resolve(TOKEN)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
  });

  it('answers SESSION_EXPIRED from the expiry instant on, judged by the Clock', async () => {
    customers.findPrincipalBySession.mockResolvedValue(row({ expires_at: NOW }));
    await expect(resolver.resolve(TOKEN)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    customers.findPrincipalBySession.mockResolvedValue(
      row({ expires_at: new Date(NOW.getTime() + 1) }),
    );
    await expect(resolver.resolve(TOKEN)).resolves.toMatchObject({ id: 7 });
  });
});
