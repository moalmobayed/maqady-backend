import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { StaffPrincipal } from '../../../../src/common/auth/types';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { AppError } from '../../../../src/common/errors/app-error';
import { money } from '../../../../src/common/money/money';
import type { BookingConfirmationService } from '../../../../src/modules/bookings/booking-confirmation.service';
import type { BookingReadService } from '../../../../src/modules/bookings/booking-read.service';
import type { BookingShowtimeService } from '../../../../src/modules/bookings/booking-showtime.service';
import type { BookingsRepository } from '../../../../src/modules/bookings/bookings.repository';
import { CounterSalesService } from '../../../../src/modules/bookings/counter-sales.service';
import type { HoldsService } from '../../../../src/modules/bookings/holds.service';
import type {
  BookingRow,
  CounterPaymentInput,
  ShowtimeContext,
} from '../../../../src/modules/bookings/types';
import type { CustomerService } from '../../../../src/modules/customers/customer.service';
import type { Customer } from '../../../../src/modules/customers/types';
import type { HallReadService } from '../../../../src/modules/halls/hall-read.service';
import type { PaymentsService } from '../../../../src/modules/payments/payments.service';
import type { Payment } from '../../../../src/modules/payments/types';
import type { SeatClaimService } from '../../../../src/modules/seating/seat-claim.service';
import { TestClock } from '../../../support/clock';
import { socketError } from '../../../support/errors';

const NOW = new Date('2026-10-16T19:00:00+03:00');
const HOLD_END = new Date('2026-10-16T19:05:00+03:00');
const STAFF: StaffPrincipal = { kind: 'staff', id: 7, role: 'box_office', sessionId: 3 };

const CONTEXT = {
  view: {
    id: 81,
    hallId: 5,
    status: 'scheduled',
    startsAt: new Date('2026-10-16T21:00:00+03:00'),
    endsAt: new Date('2026-10-16T23:00:00+03:00'),
  },
  theaterStatus: 'active',
  movieStatus: 'now_showing',
  header: {},
} as unknown as ShowtimeContext;

function row(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    id: 100,
    reference: 'MQ-7K3P9Q',
    showtime_id: 81,
    status: 'held',
    channel: 'counter',
    customer_id: null,
    created_by_staff_id: 7,
    hold_token_hash: null,
    hold_expires_at: HOLD_END,
    has_declined_payment: false,
    seat_count: 2,
    total_amount: 38000,
    currency: 'EGP',
    contact_name: null,
    contact_email: null,
    contact_phone: null,
    confirmed_at: null,
    refunded_at: null,
    qr_version: null,
    checked_in_at: null,
    checked_in_by_staff_id: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

const COUNTER_PAYMENT: Payment = {
  id: 9,
  bookingId: 100,
  kind: 'charge',
  purpose: 'sale',
  method: 'cash',
  status: 'succeeded',
  amount: money(38000),
  refundOfPaymentId: null,
  providerReference: null,
  card: null,
  walletType: null,
  settlesAt: null,
  completedAt: NOW,
  createdAt: NOW,
};

const LIVE_CLAIMS = [
  { showtime_id: 81, seat_label: 'F7', booking_id: 100, claimed_until: HOLD_END },
  { showtime_id: 81, seat_label: 'F8', booking_id: 100, claimed_until: HOLD_END },
];

const CASH: CounterPaymentInput = {
  method: 'cash',
  receiptReference: null,
  customer: { kind: 'walk_in' },
};

describe('CounterSalesService', () => {
  const calls: string[] = [];
  const logged = <T>(name: string, value: T) =>
    jest.fn(() => {
      calls.push(name);
      return Promise.resolve(value);
    });

  let holds: { create: jest.Mock; release: jest.Mock };
  let reads: { getForStaff: jest.Mock };
  let bookings: Record<
    'findByReference' | 'lockForUpdate' | 'seatsOf' | 'setCounterCustomer',
    jest.Mock
  >;
  let showtimes: { lockedBookingContext: jest.Mock };
  let halls: { findById: jest.Mock };
  let customers: { findByIdForUpdate: jest.Mock };
  let seatClaims: { lockFor: jest.Mock };
  let payments: { recordCounterCharge: jest.Mock };
  let confirmation: { confirm: jest.Mock };
  let audit: { record: jest.Mock };
  let clock: TestClock;
  let service: CounterSalesService;

  beforeEach(() => {
    calls.length = 0;
    clock = new TestClock(NOW);
    holds = {
      create: logged('hold', { booking: { reference: 'MQ-7K3P9Q' }, holdCode: null }),
      release: logged('release', undefined),
    };
    reads = { getForStaff: logged('read booking', { reference: 'MQ-7K3P9Q' }) };
    bookings = {
      findByReference: logged('find booking', row()),
      lockForUpdate: logged('lock booking', [row()]),
      seatsOf: logged('seats', [
        { booking_id: 100, seat_label: 'F7' },
        { booking_id: 100, seat_label: 'F8' },
      ]),
      setCounterCustomer: logged('set customer', row()),
    };
    showtimes = { lockedBookingContext: logged('lock showtime', CONTEXT) };
    halls = { findById: logged('hall', { id: 5, status: 'active' }) };
    customers = {
      findByIdForUpdate: logged('lock customer', {
        id: 12,
        fullName: 'Layla Hassan',
        email: 'layla@example.com',
        phone: '+201012345678',
        status: 'active',
        deletedAt: null,
      } as Customer),
    };
    seatClaims = { lockFor: logged('lock claims', LIVE_CLAIMS) };
    payments = { recordCounterCharge: logged('record payment', COUNTER_PAYMENT) };
    confirmation = { confirm: logged('confirm', undefined) };
    audit = { record: logged('audit', 1) };
    service = new CounterSalesService(
      holds as unknown as HoldsService,
      reads as unknown as BookingReadService,
      bookings as unknown as BookingsRepository,
      showtimes as unknown as BookingShowtimeService,
      halls as unknown as HallReadService,
      customers as unknown as CustomerService,
      seatClaims as unknown as SeatClaimService,
      payments as unknown as PaymentsService,
      confirmation as unknown as BookingConfirmationService,
      { run: jest.fn((fn: () => Promise<unknown>) => fn()) } as unknown as TransactionRepository,
      audit as unknown as AuditService,
      clock,
    );
  });

  it("creates the hold as the member's counter hold", async () => {
    await service.createHold(STAFF, { showtimeId: 81, labels: ['F7'] });
    expect(holds.create).toHaveBeenCalledWith({
      showtimeId: 81,
      labels: ['F7'],
      holder: { kind: 'staff', staffUserId: 7 },
    });
  });

  it('takes its locks in the order of design 7.1, then records, confirms and audits', async () => {
    const result = await service.pay(STAFF, 'MQ-7K3P9Q', CASH);
    expect(calls).toEqual([
      'find booking',
      'lock showtime',
      'hall',
      'lock booking',
      'seats',
      'lock claims',
      'record payment',
      'set customer',
      'confirm',
      'audit',
      'read booking',
    ]);
    expect(payments.recordCounterCharge).toHaveBeenCalledWith({
      bookingId: 100,
      amount: money(38000),
      method: 'cash',
      receiptReference: null,
      purpose: 'sale',
      collectedByStaffId: 7,
    });
    expect(bookings.setCounterCustomer).toHaveBeenCalledWith(100, {
      customer_id: null,
      contact_name: null,
      contact_email: null,
      contact_phone: null,
      updated_at: NOW,
    });
    expect(confirmation.confirm).toHaveBeenCalledWith(
      [{ bookingId: 100, showtimeId: 81, channel: 'counter', labels: ['F7', 'F8'] }],
      { kind: 'staff', id: 7 },
    );
    expect(audit.record).toHaveBeenCalledWith({
      actor: { kind: 'staff', id: 7 },
      action: 'payment.succeeded',
      entity: { type: 'payment', id: 9 },
      bookingId: 100,
      metadata: { method: 'cash', purpose: 'sale', channel: 'counter', customerKind: 'walk_in' },
    });
    expect(result).toEqual({ payment: COUNTER_PAYMENT, booking: { reference: 'MQ-7K3P9Q' } });
  });

  it('locks an existing customer between the showtime and the booking, and copies their contact', async () => {
    await service.pay(STAFF, 'MQ-7K3P9Q', {
      method: 'card_terminal',
      receiptReference: 'TRX-1',
      customer: { kind: 'existing', customerId: 12 },
    });
    expect(calls.slice(0, 5)).toEqual([
      'find booking',
      'lock showtime',
      'hall',
      'lock customer',
      'lock booking',
    ]);
    expect(payments.recordCounterCharge).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'card_terminal', receiptReference: 'TRX-1' }),
    );
    expect(bookings.setCounterCustomer).toHaveBeenCalledWith(100, {
      customer_id: 12,
      contact_name: 'Layla Hassan',
      contact_email: 'layla@example.com',
      contact_phone: '+201012345678',
      updated_at: NOW,
    });
  });

  it('writes typed contact details without linking any account', async () => {
    await service.pay(STAFF, 'MQ-7K3P9Q', {
      ...CASH,
      customer: { kind: 'contact', fullName: 'Karim Mostafa', email: null, phone: '+201098765432' },
    });
    expect(customers.findByIdForUpdate).not.toHaveBeenCalled();
    expect(bookings.setCounterCustomer).toHaveBeenCalledWith(100, {
      customer_id: null,
      contact_name: 'Karim Mostafa',
      contact_email: null,
      contact_phone: '+201098765432',
      updated_at: NOW,
    });
  });

  it.each([
    ['unknown', null],
    ['blocked', { id: 12, status: 'blocked', deletedAt: null }],
    ['anonymised', { id: 12, status: 'active', deletedAt: NOW }],
  ])(
    'refuses an %s customer account as VALIDATION_FAILED, before the booking lock',
    async (_, found) => {
      customers.findByIdForUpdate.mockResolvedValue(found);
      const caught = await service
        .pay(STAFF, 'MQ-7K3P9Q', { ...CASH, customer: { kind: 'existing', customerId: 12 } })
        .catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(AppError);
      expect((caught as AppError).code).toBe('VALIDATION_FAILED');
      expect((caught as AppError).details).toEqual({
        fields: [
          { field: 'customer.customerId', messages: ['No active customer account has this id.'] },
        ],
      });
      expect(bookings.lockForUpdate).not.toHaveBeenCalled();
      expect(payments.recordCounterCharge).not.toHaveBeenCalled();
    },
  );

  it('answers NOT_FOUND for an online booking or none, FORBIDDEN for a colleague’s, before any lock', async () => {
    bookings.findByReference.mockResolvedValueOnce(undefined);
    await expect(service.pay(STAFF, 'MQ-7K3P9Q', CASH)).rejects.toEqual(new AppError('NOT_FOUND'));
    bookings.findByReference.mockResolvedValueOnce(
      row({ channel: 'online', created_by_staff_id: null, customer_id: 12 }),
    );
    await expect(service.pay(STAFF, 'MQ-7K3P9Q', CASH)).rejects.toEqual(new AppError('NOT_FOUND'));
    bookings.findByReference.mockResolvedValueOnce(row({ created_by_staff_id: 8 }));
    const caught = await service.pay(STAFF, 'MQ-7K3P9Q', CASH).catch((error: unknown) => error);
    expect(caught).toEqual(new AppError('FORBIDDEN'));
    expect((caught as AppError).details).toEqual({ reason: 'not_your_counter_hold' });
    expect(showtimes.lockedBookingContext).not.toHaveBeenCalled();
  });

  it('answers ALREADY_PAID before and under the booking lock', async () => {
    bookings.findByReference.mockResolvedValueOnce(row({ status: 'confirmed' }));
    await expect(service.pay(STAFF, 'MQ-7K3P9Q', CASH)).rejects.toEqual(
      new AppError('ALREADY_PAID'),
    );
    expect(showtimes.lockedBookingContext).not.toHaveBeenCalled();
    bookings.lockForUpdate.mockResolvedValueOnce([row({ status: 'confirmed' })]);
    await expect(service.pay(STAFF, 'MQ-7K3P9Q', CASH)).rejects.toEqual(
      new AppError('ALREADY_PAID'),
    );
    expect(payments.recordCounterCharge).not.toHaveBeenCalled();
  });

  it('answers SHOWTIME_NOT_BOOKABLE with its reason before locking the booking', async () => {
    halls.findById.mockResolvedValue({ id: 5, status: 'retired' });
    const caught = await service.pay(STAFF, 'MQ-7K3P9Q', CASH).catch((error: unknown) => error);
    expect(caught).toEqual(new AppError('SHOWTIME_NOT_BOOKABLE'));
    expect((caught as AppError).details).toEqual({ reason: 'hall_unavailable' });
    expect(bookings.lockForUpdate).not.toHaveBeenCalled();
  });

  it('answers HOLD_EXPIRED at the hold end exactly, and when a claim is no longer live', async () => {
    clock.set(HOLD_END);
    await expect(service.pay(STAFF, 'MQ-7K3P9Q', CASH)).rejects.toEqual(
      new AppError('HOLD_EXPIRED'),
    );
    expect(seatClaims.lockFor).not.toHaveBeenCalled();

    clock.set(NOW);
    for (const claims of [
      LIVE_CLAIMS.slice(0, 1),
      [LIVE_CLAIMS[0], { ...LIVE_CLAIMS[1], booking_id: 101 }],
      [LIVE_CLAIMS[0], { ...LIVE_CLAIMS[1], claimed_until: NOW }],
      [LIVE_CLAIMS[0], { ...LIVE_CLAIMS[1], claimed_until: null }],
    ]) {
      seatClaims.lockFor.mockResolvedValueOnce(claims);
      await expect(service.pay(STAFF, 'MQ-7K3P9Q', CASH)).rejects.toEqual(
        new AppError('HOLD_EXPIRED'),
      );
    }
    expect(payments.recordCounterCharge).not.toHaveBeenCalled();
  });

  it('lets a datastore outage through, which the filter answers with 503', async () => {
    const outage = socketError('ECONNREFUSED');
    bookings.findByReference.mockRejectedValue(outage);
    await expect(service.pay(STAFF, 'MQ-7K3P9Q', CASH)).rejects.toBe(outage);
  });

  describe('releaseHold', () => {
    it("releases the member's own held counter hold", async () => {
      await service.releaseHold(STAFF, 'MQ-7K3P9Q');
      expect(holds.release).toHaveBeenCalledWith({ staffUserId: 7 }, 'MQ-7K3P9Q');
    });

    it('refuses a colleague’s hold, an online booking and a paid one', async () => {
      bookings.findByReference.mockResolvedValueOnce(row({ created_by_staff_id: 8 }));
      await expect(service.releaseHold(STAFF, 'MQ-7K3P9Q')).rejects.toEqual(
        new AppError('FORBIDDEN'),
      );
      bookings.findByReference.mockResolvedValueOnce(
        row({ channel: 'online', created_by_staff_id: null }),
      );
      await expect(service.releaseHold(STAFF, 'MQ-7K3P9Q')).rejects.toEqual(
        new AppError('NOT_FOUND'),
      );
      bookings.findByReference.mockResolvedValueOnce(row({ status: 'confirmed' }));
      await expect(service.releaseHold(STAFF, 'MQ-7K3P9Q')).rejects.toEqual(
        new AppError('ALREADY_PAID'),
      );
      expect(holds.release).not.toHaveBeenCalled();
    });
  });
});
