import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { money } from '../../../../src/common/money/money';
import { AdminCustomersService } from '../../../../src/modules/admin-customers/admin-customers.service';
import type { AdminBookingsService } from '../../../../src/modules/bookings/admin-bookings.service';
import type { CustomerBookingsService } from '../../../../src/modules/bookings/customer-bookings.service';
import type { SettlementService } from '../../../../src/modules/bookings/settlement.service';
import type {
  AdminBookingListItem,
  CustomerBookingStats,
} from '../../../../src/modules/bookings/types';
import type { CustomerService } from '../../../../src/modules/customers/customer.service';
import type { Customer } from '../../../../src/modules/customers/types';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-20T10:00:00Z');
const ACTOR = { kind: 'staff', id: 3 } as const;

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
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
    ...overrides,
  };
}

function stats(customerId: number, overrides: Partial<CustomerBookingStats> = {}) {
  return {
    customerId,
    bookings: 0,
    spent: money(0),
    noShows: 0,
    lastBookingAt: null,
    ...overrides,
  };
}

describe('AdminCustomersService', () => {
  let customers: jest.Mocked<CustomerService>;
  let customerBookings: jest.Mocked<CustomerBookingsService>;
  let adminBookings: jest.Mocked<AdminBookingsService>;
  let settlement: jest.Mocked<SettlementService>;
  let audit: jest.Mocked<AuditService>;
  let transactions: jest.Mocked<TransactionRepository>;
  let order: string[];
  let service: AdminCustomersService;

  beforeEach(() => {
    order = [];
    const logged =
      <T>(name: string, value: T) =>
      (..._args: unknown[]) => {
        order.push(name);
        return Promise.resolve(value);
      };
    customers = {
      list: jest.fn(
        logged('list', {
          items: [customer({ id: 9 }), customer({ id: 7 })],
          nextCursor: 'next',
          total: 4,
        }),
      ),
      findById: jest.fn(logged('find', customer())),
      findByIdForUpdate: jest.fn(logged('lock', customer())),
      updateDetails: jest.fn(logged('details', customer({ fullName: 'Layla Mansour' }))),
      setStatus: jest.fn(logged('status', customer({ status: 'blocked' }))),
      issuePasswordReset: jest.fn(logged('reset', undefined)),
    } as unknown as jest.Mocked<CustomerService>;
    customerBookings = {
      statsOf: jest.fn((ids: readonly number[]) => {
        order.push('stats');
        return Promise.resolve(new Map(ids.map((id) => [id, stats(id, { bookings: id })])));
      }),
    } as unknown as jest.Mocked<CustomerBookingsService>;
    adminBookings = {
      list: jest.fn(
        logged('recent', {
          items: [{ booking: { reference: 'MQ-AAAAAA' } } as unknown as AdminBookingListItem],
          nextCursor: null,
          total: 1,
        }),
      ),
    } as unknown as jest.Mocked<AdminBookingsService>;
    settlement = {
      settleAllDue: jest.fn(logged('settle', { settled: 0 })),
    } as unknown as jest.Mocked<SettlementService>;
    audit = { record: jest.fn(logged('audit', 1)) } as unknown as jest.Mocked<AuditService>;
    transactions = {
      run: jest.fn((fn: () => Promise<unknown>) => {
        order.push('begin');
        return fn();
      }),
    } as unknown as jest.Mocked<TransactionRepository>;
    service = new AdminCustomersService(
      customers,
      customerBookings,
      adminBookings,
      settlement,
      transactions,
      audit,
      new TestClock(NOW),
    );
  });

  describe('list', () => {
    it('settles first, then reads the page and its numbers in one call', async () => {
      const page = await service.list({ q: 'layla' }, { limit: 2 });
      expect(order).toEqual(['settle', 'list', 'stats']);
      expect(customers.list).toHaveBeenCalledWith({ q: 'layla' }, { limit: 2 });
      expect(customerBookings.statsOf).toHaveBeenCalledTimes(1);
      expect(customerBookings.statsOf).toHaveBeenCalledWith([9, 7], NOW);
      expect(page).toEqual({
        items: [
          { customer: customer({ id: 9 }), stats: stats(9, { bookings: 9 }) },
          { customer: customer({ id: 7 }), stats: stats(7, { bookings: 7 }) },
        ],
        nextCursor: 'next',
        total: 4,
      });
    });
  });

  describe('detail', () => {
    it("adds the customer's four newest bookings, read by customer", async () => {
      const detail = await service.detail(7);
      expect(adminBookings.list).toHaveBeenCalledWith({ customerId: 7 }, { limit: 4 });
      expect(detail.customer.id).toBe(7);
      expect(detail.stats).toEqual(stats(7, { bookings: 7 }));
      expect(detail.recentBookings).toHaveLength(1);
    });

    it('answers NOT_FOUND for a missing or anonymised customer, reading nothing else', async () => {
      customers.findById.mockResolvedValueOnce(null);
      await expect(service.detail(9)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      customers.findById.mockResolvedValueOnce(customer({ deletedAt: NOW, email: null }));
      await expect(service.detail(7)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(adminBookings.list).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('changes the details, then the status, in one transaction', async () => {
      const item = await service.update(ACTOR, 7, {
        fullName: 'Layla Mansour',
        phone: null,
        status: 'blocked',
      });
      expect(order).toEqual(['begin', 'find', 'details', 'status', 'stats']);
      expect(customers.updateDetails).toHaveBeenCalledWith(ACTOR, 7, {
        fullName: 'Layla Mansour',
        phone: null,
      });
      expect(customers.setStatus).toHaveBeenCalledWith(ACTOR, 7, 'blocked');
      expect(item.customer.status).toBe('blocked');
    });

    it('only blocks when only the status is sent', async () => {
      await service.update(ACTOR, 7, { status: 'active' });
      expect(customers.updateDetails).not.toHaveBeenCalled();
      expect(customers.setStatus).toHaveBeenCalledWith(ACTOR, 7, 'active');
    });

    it('answers NOT_FOUND for an anonymised customer', async () => {
      customers.findById.mockResolvedValueOnce(customer({ deletedAt: NOW, email: null }));
      await expect(service.update(ACTOR, 7, { fullName: 'X' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(customers.updateDetails).not.toHaveBeenCalled();
    });
  });

  describe('sendPasswordReset', () => {
    it('locks the customer, sends the link and audits it, without personal data', async () => {
      const result = await service.sendPasswordReset(ACTOR, 7);
      expect(order).toEqual(['begin', 'lock', 'reset', 'audit']);
      expect(customers.issuePasswordReset).toHaveBeenCalledWith(7);
      expect(audit.record).toHaveBeenCalledWith({
        actor: ACTOR,
        action: 'customer.password_reset_sent',
        entity: { type: 'customer', id: 7 },
      });
      expect(result).toEqual({ channel: 'email', queuedAt: NOW });
    });

    it('refuses a blocked customer with CUSTOMER_BLOCKED and a missing one with NOT_FOUND', async () => {
      customers.findByIdForUpdate.mockResolvedValueOnce(customer({ status: 'blocked' }));
      await expect(service.sendPasswordReset(ACTOR, 7)).rejects.toMatchObject({
        code: 'CUSTOMER_BLOCKED',
      });
      customers.findByIdForUpdate.mockResolvedValueOnce(null);
      await expect(service.sendPasswordReset(ACTOR, 9)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      customers.findByIdForUpdate.mockResolvedValueOnce(customer({ deletedAt: NOW }));
      await expect(service.sendPasswordReset(ACTOR, 7)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(customers.issuePasswordReset).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});
