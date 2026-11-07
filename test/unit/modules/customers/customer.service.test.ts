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
      findLiveByEmail: jest.fn().mockResolvedValue(undefined),
      updateDetails: jest.fn((_id: number, update: Record<string, unknown>) =>
        Promise.resolve(customer({ ...update })),
      ),
      anonymise: jest.fn().mockResolvedValue(ANONYMISED),
      pageForAdmin: jest.fn().mockResolvedValue([]),
      countForAdmin: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<CustomersRepository>;
    sessions = {
      revokeAllFor: jest.fn().mockResolvedValue(2),
    } as unknown as jest.Mocked<SessionService>;
    oneTimeTokens = {
      issue: jest.fn().mockResolvedValue({ id: 5, token: 't'.repeat(43), expiresAt: NOW }),
      invalidateAllFor: jest.fn().mockResolvedValue(1),
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

  describe('list', () => {
    it('reads a page and the total, and builds the next cursor from the last row', async () => {
      const rows = [
        customer({ id: 9, created_at: new Date('2026-10-03T10:00:00Z') }),
        customer({ id: 8, created_at: new Date('2026-10-02T10:00:00Z') }),
        customer({ id: 7 }),
      ];
      customers.pageForAdmin.mockResolvedValueOnce(rows);
      customers.countForAdmin.mockResolvedValueOnce(5);

      const page = await service.list({ q: 'layla', status: 'active' }, { limit: 2 });
      expect(customers.pageForAdmin).toHaveBeenCalledWith(
        { q: 'layla', status: 'active' },
        { after: null, limit: 2 },
      );
      expect(customers.countForAdmin).toHaveBeenCalledWith({ q: 'layla', status: 'active' });
      expect(page.items.map((item) => item.id)).toEqual([9, 8]);
      expect(page.total).toBe(5);
      const cursor = JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString('utf8'));
      expect(cursor).toEqual(['2026-10-02T10:00:00.000Z', 8]);
      expect(page.items[0]).not.toHaveProperty('passwordHash');
    });

    it('refuses a cursor whose sort key is not an instant', async () => {
      const cursor = Buffer.from(JSON.stringify([null, 3])).toString('base64url');
      await expect(service.list({}, { cursor })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      expect(customers.pageForAdmin).not.toHaveBeenCalled();
    });
  });

  describe('updateDetails', () => {
    it('writes only the fields that differ, and audits their names', async () => {
      const updated = await service.updateDetails(ACTOR, 7, {
        fullName: 'Layla Mansour',
        phone: '+201012345678',
      });
      expect(customers.findByIdForUpdate).toHaveBeenCalledWith(7);
      expect(customers.updateDetails).toHaveBeenCalledWith(7, {
        full_name: 'Layla Mansour',
        phone: '+201012345678',
        updated_at: NOW,
      });
      expect(updated.fullName).toBe('Layla Mansour');
      expect(oneTimeTokens.invalidateAllFor).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith({
        actor: ACTOR,
        action: 'customer.updated',
        entity: { type: 'customer', id: 7 },
        changedFields: ['fullName', 'phone'],
      });
    });

    it('writes and audits nothing when every value is already stored', async () => {
      const same = await service.updateDetails(ACTOR, 7, {
        fullName: 'Layla Hassan',
        email: 'layla@example.com',
        phone: null,
      });
      expect(same.id).toBe(7);
      expect(customers.updateDetails).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('unverifies a new address and deletes the unused links sent to the old one', async () => {
      customers.findByIdForUpdate.mockResolvedValueOnce(customer({ email_verified_at: NOW }));
      await service.updateDetails(ACTOR, 7, { email: 'layla.new@example.com' });
      expect(customers.findLiveByEmail).toHaveBeenCalledWith('layla.new@example.com');
      expect(customers.updateDetails).toHaveBeenCalledWith(7, {
        email: 'layla.new@example.com',
        email_verified_at: null,
        updated_at: NOW,
      });
      expect(oneTimeTokens.invalidateAllFor).toHaveBeenCalledWith({ kind: 'customer', id: 7 });
    });

    it('keeps the verification and the links on a change of letter case only', async () => {
      await service.updateDetails(ACTOR, 7, { email: 'Layla@Example.com' });
      expect(customers.findLiveByEmail).not.toHaveBeenCalled();
      expect(customers.updateDetails).toHaveBeenCalledWith(7, {
        email: 'Layla@Example.com',
        updated_at: NOW,
      });
      expect(oneTimeTokens.invalidateAllFor).not.toHaveBeenCalled();
    });

    it("answers EMAIL_TAKEN for another live customer's address, writing nothing", async () => {
      customers.findLiveByEmail.mockResolvedValueOnce(customer({ id: 8 }));
      await expect(
        service.updateDetails(ACTOR, 7, { fullName: 'X', email: 'omar@example.com' }),
      ).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
      expect(customers.updateDetails).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('answers NOT_FOUND for a missing or anonymised customer', async () => {
      customers.findByIdForUpdate.mockResolvedValueOnce(undefined);
      await expect(service.updateDetails(ACTOR, 9, { fullName: 'X' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      customers.findByIdForUpdate.mockResolvedValueOnce(ANONYMISED);
      await expect(service.updateDetails(ACTOR, 7, { fullName: 'X' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(customers.updateDetails).not.toHaveBeenCalled();
    });
  });

  describe('anonymise', () => {
    it('clears the row at the clock time and maps it', async () => {
      const result = await service.anonymise(7);
      expect(customers.anonymise).toHaveBeenCalledWith(7, NOW);
      expect(result).toMatchObject({ email: null, fullName: null, deletedAt: NOW });
    });
  });
});
