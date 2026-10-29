import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import type { IdempotencyService } from '../../../../src/common/idempotency/idempotency.service';
import { CustomerAnonymisationService } from '../../../../src/modules/admin-customers/customer-anonymisation.service';
import type { OneTimeTokenService } from '../../../../src/modules/auth/one-time-token.service';
import type { SessionService } from '../../../../src/modules/auth/session.service';
import type { BookingNotesService } from '../../../../src/modules/bookings/booking-notes.service';
import type { CustomerBookingsService } from '../../../../src/modules/bookings/customer-bookings.service';
import type { CustomerService } from '../../../../src/modules/customers/customer.service';
import type { Customer } from '../../../../src/modules/customers/types';
import type { MessagingService } from '../../../../src/modules/messaging/messaging.service';

const NOW = new Date('2026-10-20T10:00:00Z');
const ACTOR = { kind: 'staff', id: 3 } as const;

const LIVE: Customer = {
  id: 7,
  email: 'layla@example.com',
  fullName: 'Layla Hassan',
  phone: '+201012345678',
  status: 'blocked',
  emailVerifiedAt: null,
  lastSignInAt: null,
  createdAt: new Date('2026-10-01T10:00:00Z'),
  updatedAt: new Date('2026-10-01T10:00:00Z'),
  deletedAt: null,
};
const ANONYMISED: Customer = {
  ...LIVE,
  email: null,
  fullName: null,
  phone: null,
  deletedAt: NOW,
  updatedAt: NOW,
};

describe('CustomerAnonymisationService', () => {
  let order: string[];
  let customers: jest.Mocked<CustomerService>;
  let customerBookings: jest.Mocked<CustomerBookingsService>;
  let notes: jest.Mocked<BookingNotesService>;
  let sessions: jest.Mocked<SessionService>;
  let oneTimeTokens: jest.Mocked<OneTimeTokenService>;
  let idempotency: jest.Mocked<IdempotencyService>;
  let messaging: jest.Mocked<MessagingService>;
  let audit: jest.Mocked<AuditService>;
  let service: CustomerAnonymisationService;

  beforeEach(() => {
    order = [];
    const logged =
      <T>(name: string, value: T) =>
      (..._args: unknown[]) => {
        order.push(name);
        return Promise.resolve(value);
      };
    customers = {
      findByIdForUpdate: jest.fn(logged('lock customer', LIVE)),
      anonymise: jest.fn(logged('clear customer', ANONYMISED)),
    } as unknown as jest.Mocked<CustomerService>;
    customerBookings = {
      clearContactsOf: jest.fn(logged('clear contacts', { bookings: 3, cleared: 2 })),
    } as unknown as jest.Mocked<CustomerBookingsService>;
    notes = {
      deleteForCustomer: jest.fn(logged('notes', 1)),
    } as unknown as jest.Mocked<BookingNotesService>;
    sessions = {
      deleteAllFor: jest.fn(logged('sessions', 4)),
    } as unknown as jest.Mocked<SessionService>;
    oneTimeTokens = {
      deleteAllFor: jest.fn(logged('tokens', 2)),
    } as unknown as jest.Mocked<OneTimeTokenService>;
    idempotency = {
      deleteForScope: jest.fn(logged('keys', 5)),
    } as unknown as jest.Mocked<IdempotencyService>;
    messaging = {
      deleteForCustomer: jest.fn(logged('messages', 6)),
    } as unknown as jest.Mocked<MessagingService>;
    audit = { record: jest.fn(logged('audit', 1)) } as unknown as jest.Mocked<AuditService>;
    const transactions = {
      run: jest.fn((fn: () => Promise<unknown>) => {
        order.push('begin');
        return fn();
      }),
    } as unknown as TransactionRepository;
    service = new CustomerAnonymisationService(
      customers,
      customerBookings,
      notes,
      sessions,
      oneTimeTokens,
      idempotency,
      messaging,
      transactions,
      audit,
    );
  });

  it('locks the customer, then removes what points at them, then clears the row, in one transaction', async () => {
    const result = await service.anonymise(ACTOR, 7);

    expect(order).toEqual([
      'begin',
      'lock customer',
      'clear contacts',
      'notes',
      'sessions',
      'tokens',
      'keys',
      'messages',
      'clear customer',
      'audit',
    ]);
    expect(customerBookings.clearContactsOf).toHaveBeenCalledWith(7);
    expect(notes.deleteForCustomer).toHaveBeenCalledWith(7);
    expect(sessions.deleteAllFor).toHaveBeenCalledWith({ audience: 'customer', id: 7 });
    expect(oneTimeTokens.deleteAllFor).toHaveBeenCalledWith({ kind: 'customer', id: 7 });
    expect(idempotency.deleteForScope).toHaveBeenCalledWith('customer:7');
    expect(messaging.deleteForCustomer).toHaveBeenCalledWith(7);
    expect(customers.anonymise).toHaveBeenCalledWith(7);
    expect(result).toEqual({
      customerId: 7,
      anonymisedAt: NOW,
      bookingsKept: 3,
      removed: {
        sessions: 4,
        oneTimeTokens: 2,
        idempotencyKeys: 5,
        messages: 6,
        bookingNotes: 1,
        bookingContacts: 2,
      },
    });
  });

  it('audits the cleared field names and the counts, never a value', async () => {
    await service.anonymise(ACTOR, 7);
    expect(audit.record).toHaveBeenCalledWith({
      actor: ACTOR,
      action: 'customer.anonymised',
      entity: { type: 'customer', id: 7 },
      changedFields: ['fullName', 'email', 'phone', 'passwordHash'],
      metadata: {
        bookingsKept: 3,
        sessionsDeleted: 4,
        linksDeleted: 2,
        idempotencyKeysDeleted: 5,
        messagesDeleted: 6,
        notesDeleted: 1,
        contactsCleared: 2,
      },
    });
    const recorded = JSON.stringify(audit.record.mock.calls);
    for (const value of ['Layla', 'layla@example.com', '+201012345678']) {
      expect(recorded).not.toContain(value);
    }
  });

  it.each([
    ['missing', null],
    ['already anonymised', ANONYMISED],
  ])('answers NOT_FOUND for a %s customer before any write', async (_label, found) => {
    customers.findByIdForUpdate.mockImplementationOnce(() => {
      order.push('lock customer');
      return Promise.resolve(found);
    });
    await expect(service.anonymise(ACTOR, 7)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(order).toEqual(['begin', 'lock customer']);
  });
});
