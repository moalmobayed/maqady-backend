import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { resolveException } from '../../../../src/common/errors/error-mapping';
import type { BookingsRepository } from '../../../../src/modules/bookings/bookings.repository';
import { TicketDeliveryService } from '../../../../src/modules/bookings/ticket-delivery.service';
import type { TicketsService } from '../../../../src/modules/bookings/tickets.service';
import type { BookingRow } from '../../../../src/modules/bookings/types';
import type { CustomerService } from '../../../../src/modules/customers/customer.service';
import type { ShowtimeReadService } from '../../../../src/modules/showtimes/showtime-read.service';
import { bookingRow } from '../../../support/booking-rows';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-16T19:00:00+03:00');
const ENDS_AT = new Date('2026-10-16T21:30:00+03:00');
const ACCOUNT_EMAIL = 'mona.account@example.com';

describe('TicketDeliveryService', () => {
  const calls: string[] = [];
  let found: BookingRow | undefined;
  let locked: BookingRow;
  let endsAt: Date;
  let customer: Record<string, unknown> | null;
  let tickets: { queueTickets: jest.Mock };
  let audit: { record: jest.Mock };
  let service: TicketDeliveryService;

  beforeEach(() => {
    calls.length = 0;
    found = bookingRow();
    locked = bookingRow();
    endsAt = ENDS_AT;
    customer = { id: 12, email: ACCOUNT_EMAIL, deletedAt: null, status: 'active' };
    const bookings = {
      findByReference: jest.fn(() => {
        calls.push('find');
        return Promise.resolve(found);
      }),
      lockForUpdate: jest.fn(() => {
        calls.push('lock');
        return Promise.resolve([locked]);
      }),
    };
    const showtimes = {
      findByIds: jest.fn(() => {
        calls.push('showtime');
        return Promise.resolve(new Map([[81, { id: 81, endsAt }]]));
      }),
    };
    const customers = {
      findById: jest.fn(() => {
        calls.push('customer');
        return Promise.resolve(customer);
      }),
    };
    tickets = {
      queueTickets: jest.fn(() => {
        calls.push('queue');
        return Promise.resolve();
      }),
    };
    audit = {
      record: jest.fn(() => {
        calls.push('audit');
        return Promise.resolve(1);
      }),
    };
    service = new TicketDeliveryService(
      bookings as unknown as BookingsRepository,
      showtimes as unknown as ShowtimeReadService,
      customers as unknown as CustomerService,
      tickets as unknown as TicketsService,
      audit as unknown as AuditService,
      { run: jest.fn((fn: () => Promise<unknown>) => fn()) } as unknown as TransactionRepository,
      new TestClock(NOW),
    );
  });

  const refusal = async () =>
    resolveException(await service.emailAgain('MQ-7K3P9Q', 12).catch((e: unknown) => e));

  it('locks the booking, checks it under the lock, then queues the email to the account address and audits it', async () => {
    await expect(service.emailAgain('MQ-7K3P9Q', 12)).resolves.toEqual({
      channel: 'email',
      queuedAt: NOW,
    });
    expect(calls).toEqual(['find', 'lock', 'showtime', 'customer', 'queue', 'audit']);
    expect(tickets.queueTickets).toHaveBeenCalledWith([100], {
      sms: false,
      emailTo: ACCOUNT_EMAIL,
    });
    expect(audit.record).toHaveBeenCalledWith({
      actor: { kind: 'customer', id: 12 },
      action: 'booking.tickets_resent',
      entity: { type: 'booking', id: 100 },
      bookingId: 100,
      metadata: { channel: 'email' },
    });
  });

  it('sends a completed booking again too', async () => {
    endsAt = new Date(NOW.getTime() - 1);
    await expect(service.emailAgain('MQ-7K3P9Q', 12)).resolves.toMatchObject({ channel: 'email' });
  });

  it.each([
    ['an unknown reference', undefined],
    ["another customer's booking", bookingRow({ customer_id: 99 })],
    ["a guest's hold", bookingRow({ customer_id: null })],
  ])('answers NOT_FOUND for %s before any lock', async (_, row) => {
    found = row;
    expect(await refusal()).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(calls).toEqual(['find']);
  });

  it.each([
    ['held', { status: 'held', hold_expires_at: new Date(NOW.getTime() + 60_000) }],
    ['failed', { status: 'held', hold_expires_at: NOW, has_declined_payment: true }],
    ['abandoned', { status: 'held', hold_expires_at: NOW }],
    ['refunded', { status: 'refunded', refunded_at: NOW }],
  ] as const)(
    'answers TICKET_NOT_AVAILABLE for a %s booking, as locked, with nothing queued',
    async (status, fields) => {
      locked = bookingRow(fields);
      expect(await refusal()).toMatchObject({
        status: 409,
        code: 'TICKET_NOT_AVAILABLE',
        details: { status },
      });
      expect(tickets.queueTickets).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['gone', null],
    ['anonymised', { id: 12, email: null, deletedAt: NOW, status: 'active' }],
  ])('answers UNAUTHENTICATED for an account %s, with nothing queued', async (_, account) => {
    customer = account;
    expect(await refusal()).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(tickets.queueTickets).not.toHaveBeenCalled();
  });
});
