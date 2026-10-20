import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import type { OneTimeTokenService } from '../../../../src/modules/auth/one-time-token.service';
import type { SessionService } from '../../../../src/modules/auth/session.service';
import { CustomerService } from '../../../../src/modules/customers/customer.service';
import type { CustomersRepository } from '../../../../src/modules/customers/customers.repository';
import { customerPasswordResetTemplate } from '../../../../src/modules/customers/templates/customer-password-reset.template';
import type { CustomerRow } from '../../../../src/modules/customers/types';
import type { MessagingService } from '../../../../src/modules/messaging/messaging.service';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-20T10:00:00Z');
const ACTOR = { kind: 'staff', id: 3 } as const;

function customer(overrides: Partial<CustomerRow> = {}): CustomerRow {
  return {
    id: 7,
    email: 'layla@example.com',
    full_name: 'Layla Hassan',
    phone: null,
    password_hash: 'scrypt$16384$8$5$c2FsdA$a2V5',
    status: 'active',
    email_verified_at: null,
    last_sign_in_at: null,
    created_at: new Date('2026-10-01T10:00:00Z'),
    updated_at: new Date('2026-10-01T10:00:00Z'),
    deleted_at: null,
    ...overrides,
  };
}

const ANONYMISED = customer({
  deleted_at: NOW,
  email: null,
  full_name: null,
  password_hash: null,
});

describe('CustomerService', () => {
  let customers: jest.Mocked<CustomersRepository>;
  let sessions: jest.Mocked<SessionService>;
  let oneTimeTokens: jest.Mocked<OneTimeTokenService>;
  let messaging: jest.Mocked<MessagingService>;
  let audit: jest.Mocked<AuditService>;
  let service: CustomerService;

  beforeEach(() => {
    customers = {
      findById: jest.fn().mockResolvedValue(customer()),
      findByIdForUpdate: jest.fn().mockResolvedValue(customer()),
      setStatus: jest.fn().mockResolvedValue(customer({ status: 'blocked', updated_at: NOW })),
    } as unknown as jest.Mocked<CustomersRepository>;
    sessions = {
      revokeAllFor: jest.fn().mockResolvedValue(2),
    } as unknown as jest.Mocked<SessionService>;
    oneTimeTokens = {
      issue: jest.fn().mockResolvedValue({ id: 5, token: 't'.repeat(43), expiresAt: NOW }),
    } as unknown as jest.Mocked<OneTimeTokenService>;
    messaging = {
      queue: jest.fn().mockResolvedValue({ id: 1 }),
    } as unknown as jest.Mocked<MessagingService>;
    audit = { record: jest.fn().mockResolvedValue(1) } as unknown as jest.Mocked<AuditService>;
    const transactions = {
      run: jest.fn((fn: () => Promise<unknown>) => fn()),
    } as unknown as TransactionRepository;
    service = new CustomerService(
      customers,
      sessions,
      oneTimeTokens,
      messaging,
      transactions,
      audit,
      new TestClock(NOW),
    );
  });

  it('maps rows without the password hash, and answers null for an unknown id', async () => {
    await expect(service.findById(7)).resolves.toEqual({
      id: 7,
      email: 'layla@example.com',
      fullName: 'Layla Hassan',
      phone: null,
      status: 'active',
      emailVerifiedAt: null,
      lastSignInAt: null,
      createdAt: new Date('2026-10-01T10:00:00Z'),
      updatedAt: new Date('2026-10-01T10:00:00Z'),
      deletedAt: null,
    });
    customers.findByIdForUpdate.mockResolvedValue(undefined);
    await expect(service.findByIdForUpdate(8)).resolves.toBeNull();
  });

  describe('setStatus', () => {
    it('blocks under the row lock, revokes every session and audits the change', async () => {
      const result = await service.setStatus(ACTOR, 7, 'blocked');
      expect(customers.findByIdForUpdate).toHaveBeenCalledWith(7);
      expect(customers.setStatus).toHaveBeenCalledWith(7, 'blocked', NOW);
      expect(sessions.revokeAllFor).toHaveBeenCalledWith(
        { audience: 'customer', id: 7 },
        'account_blocked',
      );
      expect(audit.record).toHaveBeenCalledWith({
        actor: ACTOR,
        action: 'customer.status_changed',
        entity: { type: 'customer', id: 7 },
        changedFields: ['status'],
        metadata: { status: 'blocked' },
      });
      expect(result.status).toBe('blocked');
    });

    it('unblocks without revoking anything', async () => {
      customers.findByIdForUpdate.mockResolvedValue(customer({ status: 'blocked' }));
      customers.setStatus.mockResolvedValue(customer({ status: 'active' }));
      await service.setStatus(ACTOR, 7, 'active');
      expect(sessions.revokeAllFor).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { status: 'active' } }),
      );
    });

    it('changes, revokes and audits nothing when the status is already the one asked for', async () => {
      await expect(service.setStatus(ACTOR, 7, 'active')).resolves.toMatchObject({
        status: 'active',
      });
      expect(customers.setStatus).not.toHaveBeenCalled();
      expect(sessions.revokeAllFor).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('answers NOT_FOUND for a missing or anonymised customer', async () => {
      customers.findByIdForUpdate.mockResolvedValueOnce(undefined);
      await expect(service.setStatus(ACTOR, 9, 'blocked')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      customers.findByIdForUpdate.mockResolvedValueOnce(ANONYMISED);
      await expect(service.setStatus(ACTOR, 7, 'blocked')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(customers.setStatus).not.toHaveBeenCalled();
    });
  });

  describe('issuePasswordReset', () => {
    it('issues a 1-hour reset link and queues the email to the customer', async () => {
      await service.issuePasswordReset(7);
      expect(oneTimeTokens.issue).toHaveBeenCalledWith({
        purpose: 'customer_password_reset',
        owner: { kind: 'customer', id: 7 },
        lifetimeSeconds: 3600,
      });
      expect(messaging.queue).toHaveBeenCalledWith({
        template: customerPasswordResetTemplate,
        recipient: 'layla@example.com',
        params: { fullName: 'Layla Hassan', token: 't'.repeat(43) },
        related: { customerId: 7 },
      });
    });

    it('answers NOT_FOUND for a missing or anonymised customer, issuing nothing', async () => {
      customers.findById.mockResolvedValueOnce(undefined);
      await expect(service.issuePasswordReset(9)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      customers.findById.mockResolvedValueOnce(ANONYMISED);
      await expect(service.issuePasswordReset(7)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(oneTimeTokens.issue).not.toHaveBeenCalled();
    });
  });
});
