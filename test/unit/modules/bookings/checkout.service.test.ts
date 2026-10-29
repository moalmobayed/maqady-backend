import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { AppError } from '../../../../src/common/errors/app-error';
import { resolveException } from '../../../../src/common/errors/error-mapping';
import { money } from '../../../../src/common/money/money';
import type { BookingConfirmationService } from '../../../../src/modules/bookings/booking-confirmation.service';
import type { BookingShowtimeService } from '../../../../src/modules/bookings/booking-showtime.service';
import type { BookingViews } from '../../../../src/modules/bookings/booking-views.service';
import type { BookingsRepository } from '../../../../src/modules/bookings/bookings.repository';
import { CheckoutService } from '../../../../src/modules/bookings/checkout.service';
import type { BookingRow, ShowtimeContext } from '../../../../src/modules/bookings/types';
import type { CustomerService } from '../../../../src/modules/customers/customer.service';
import type { Customer } from '../../../../src/modules/customers/types';
import type { HallReadService } from '../../../../src/modules/halls/hall-read.service';
import type { PaymentsService } from '../../../../src/modules/payments/payments.service';
import type { Payment } from '../../../../src/modules/payments/types';
import type { SeatClaimService } from '../../../../src/modules/seating/seat-claim.service';
import type { SeatEventPublisher } from '../../../../src/modules/seating/seat-event.publisher';
import { TestClock } from '../../../support/clock';
import { socketError } from '../../../support/errors';

const NOW = new Date('2026-10-16T19:00:00+03:00');
const HOLD_END = new Date('2026-10-16T19:05:00+03:00');
const STARTS_AT = new Date('2026-10-16T21:00:00+03:00');

const CONTEXT = {
  view: {
    id: 81,
    hallId: 5,
    status: 'scheduled',
    startsAt: STARTS_AT,
    endsAt: new Date('2026-10-16T23:00:00+03:00'),
  },
  theaterStatus: 'active',
  movieStatus: 'now_showing',
  header: {},
} as unknown as ShowtimeContext;

const CUSTOMER = { id: 12, status: 'active', deletedAt: null } as Customer;

function row(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    id: 100,
    reference: 'MQ-7K3P9Q',
    showtime_id: 81,
    status: 'held',
    channel: 'online',
    customer_id: 12,
    created_by_staff_id: null,
    hold_token_hash: null,
    hold_expires_at: HOLD_END,
    has_declined_payment: false,
    seat_count: 2,
    total_amount: 38000,
    currency: 'EGP',
    contact_name: 'Mona Adel',
    contact_email: 'mona@example.com',
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

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 7,
    bookingId: 100,
    kind: 'charge',
    purpose: 'sale',
    method: 'card',
    status: 'succeeded',
    amount: money(38000),
    refundOfPaymentId: null,
    providerReference: 'sim.sim_card_visa.1.0123456789abcdef',
    card: { brand: 'visa', last4: '4242' },
    walletType: null,
    settlesAt: null,
    completedAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

const SEATS = [
  { booking_id: 100, seat_label: 'F7' },
  { booking_id: 100, seat_label: 'F8' },
];
const LIVE_CLAIMS = [
  { showtime_id: 81, seat_label: 'F7', booking_id: 100, claimed_until: HOLD_END },
  { showtime_id: 81, seat_label: 'F8', booking_id: 100, claimed_until: HOLD_END },
];

describe('CheckoutService', () => {
  const calls: string[] = [];
  const logged = <T>(name: string, value: T) =>
    jest.fn(() => {
      calls.push(name);
      return Promise.resolve(value);
    });

  let bookings: Record<
    'findByReference' | 'lockForUpdate' | 'seatsOf' | 'findByIds' | 'markDeclined' | 'extendHold',
    jest.Mock
  >;
  let showtimes: { lockedBookingContext: jest.Mock };
  let halls: { findById: jest.Mock };
  let customers: { findByIdForUpdate: jest.Mock };
  let seatClaims: { lockFor: jest.Mock; extend: jest.Mock };
  let payments: { processingSaleBookingIds: jest.Mock; chargeOnline: jest.Mock };
  let confirmation: { confirm: jest.Mock };
  let events: { publishAfterCommit: jest.Mock };
  let views: { of: jest.Mock };
  let audit: { record: jest.Mock };
  let clock: TestClock;
  let service: CheckoutService;

  const input = {
    reference: 'MQ-7K3P9Q',
    customerId: 12,
    method: 'card',
    token: 'sim_card_visa',
  } as const;

  beforeEach(() => {
    calls.length = 0;
    clock = new TestClock(NOW);
    bookings = {
      findByReference: logged('find booking', row()),
      lockForUpdate: logged('lock booking', [row()]),
      seatsOf: logged('seats', SEATS),
      findByIds: logged('reread booking', [row({ status: 'confirmed' })]),
      markDeclined: logged('mark declined', undefined),
      extendHold: jest.fn((_id: number, until: Date) => {
        calls.push('extend hold');
        return Promise.resolve(row({ hold_expires_at: until }));
      }),
    };
    showtimes = { lockedBookingContext: logged('lock showtime', CONTEXT) };
    halls = { findById: logged('hall', { id: 5, status: 'active' }) };
    customers = { findByIdForUpdate: logged('lock customer', CUSTOMER) };
    seatClaims = {
      lockFor: logged('lock claims', LIVE_CLAIMS),
      extend: logged('extend claims', 2),
    };
    payments = {
      processingSaleBookingIds: logged('processing check', new Set()),
      chargeOnline: logged('charge', payment()),
    };
    confirmation = { confirm: logged('confirm', undefined) };
    events = { publishAfterCommit: logged('publish', undefined) };
    views = { of: logged('view', { reference: 'MQ-7K3P9Q' }) };
    audit = { record: logged('audit', 1) };
    service = new CheckoutService(
      bookings as unknown as BookingsRepository,
      showtimes as unknown as BookingShowtimeService,
      halls as unknown as HallReadService,
      customers as unknown as CustomerService,
      seatClaims as unknown as SeatClaimService,
      payments as unknown as PaymentsService,
      confirmation as unknown as BookingConfirmationService,
      events as unknown as SeatEventPublisher,
      views as unknown as BookingViews,
      { run: jest.fn((fn: () => Promise<unknown>) => fn()) } as unknown as TransactionRepository,
      audit as unknown as AuditService,
      clock,
    );
  });

  it('takes its locks in the order of design 7.1, then charges, confirms and audits', async () => {
    const result = await service.pay(input);
    expect(calls).toEqual([
      'find booking',
      'lock showtime',
      'hall',
      'lock customer',
      'lock booking',
      'processing check',
      'seats',
      'lock claims',
      'charge',
      'confirm',
      'reread booking',
      'audit',
      'view',
    ]);
    expect(seatClaims.lockFor).toHaveBeenCalledWith([{ showtimeId: 81, labels: ['F7', 'F8'] }]);
    expect(payments.chargeOnline).toHaveBeenCalledWith({
      bookingId: 100,
      reference: 'MQ-7K3P9Q',
      amount: money(38000),
      method: 'card',
      token: 'sim_card_visa',
    });
    expect(confirmation.confirm).toHaveBeenCalledWith(
      [{ bookingId: 100, showtimeId: 81, channel: 'online', labels: ['F7', 'F8'] }],
      { kind: 'customer', id: 12 },
    );
    expect(audit.record).toHaveBeenCalledWith({
      actor: { kind: 'customer', id: 12 },
      action: 'payment.succeeded',
      entity: { type: 'payment', id: 7 },
      bookingId: 100,
      metadata: { method: 'card', purpose: 'sale' },
    });
    expect(result.payment.status).toBe('succeeded');
  });

  it('marks a decline on the hold and confirms nothing; a closed wallet changes nothing', async () => {
    payments.chargeOnline.mockResolvedValue(payment({ status: 'declined' }));
    await service.pay(input);
    expect(bookings.markDeclined).toHaveBeenCalledWith([100], NOW);
    expect(confirmation.confirm).not.toHaveBeenCalled();

    bookings.markDeclined.mockClear();
    payments.chargeOnline.mockResolvedValue(payment({ status: 'cancelled', method: 'wallet' }));
    await service.pay({ ...input, method: 'wallet', token: 'sim_wallet_cancelled' });
    expect(bookings.markDeclined).not.toHaveBeenCalled();
    expect(confirmation.confirm).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'payment.cancelled' }),
    );
  });

  it('extends a processing hold to its result plus 30 s only when that is later, and announces it', async () => {
    clock.set(new Date(HOLD_END.getTime() - 15_000));
    const settlesAt = new Date(HOLD_END.getTime() - 5_000);
    payments.chargeOnline.mockResolvedValue(
      payment({ status: 'processing', settlesAt, completedAt: null }),
    );
    await service.pay(input);
    const until = new Date(settlesAt.getTime() + 30_000);
    expect(bookings.extendHold).toHaveBeenCalledWith(100, until, clock.now());
    expect(seatClaims.extend).toHaveBeenCalledWith(
      { showtimeId: 81, bookingId: 100, labels: ['F7', 'F8'] },
      until,
    );
    expect(events.publishAfterCommit).toHaveBeenCalledWith({
      type: 'seat.held',
      showtimeId: 81,
      labels: ['F7', 'F8'],
      heldUntil: until,
    });

    bookings.extendHold.mockClear();
    events.publishAfterCommit.mockClear();
    clock.set(NOW);
    payments.chargeOnline.mockResolvedValue(
      payment({
        status: 'processing',
        settlesAt: new Date(NOW.getTime() + 10_000),
        completedAt: null,
      }),
    );
    await service.pay(input);
    expect(bookings.extendHold).not.toHaveBeenCalled();
    expect(events.publishAfterCommit).not.toHaveBeenCalled();
  });

  it.each<[string, () => void, AppError]>([
    [
      'an unknown reference',
      () => bookings.findByReference.mockResolvedValue(undefined),
      new AppError('NOT_FOUND'),
    ],
    [
      "someone else's booking",
      () => bookings.findByReference.mockResolvedValue(row({ customer_id: 44 })),
      new AppError('NOT_FOUND'),
    ],
    [
      'a paid booking',
      () => bookings.findByReference.mockResolvedValue(row({ status: 'confirmed' })),
      new AppError('ALREADY_PAID'),
    ],
    [
      'a started showtime',
      () =>
        showtimes.lockedBookingContext.mockResolvedValue({
          ...CONTEXT,
          view: { ...CONTEXT.view, startsAt: NOW },
        }),
      new AppError('SHOWTIME_NOT_BOOKABLE', undefined, { reason: 'started' }),
    ],
    [
      'a paused theater',
      () =>
        showtimes.lockedBookingContext.mockResolvedValue({
          ...CONTEXT,
          theaterStatus: 'sales_paused',
        }),
      new AppError('SHOWTIME_NOT_BOOKABLE', undefined, { reason: 'sales_paused' }),
    ],
    [
      'a blocked customer',
      () => customers.findByIdForUpdate.mockResolvedValue({ ...CUSTOMER, status: 'blocked' }),
      new AppError('ACCOUNT_BLOCKED'),
    ],
    [
      'an anonymised customer',
      () => customers.findByIdForUpdate.mockResolvedValue({ ...CUSTOMER, deletedAt: NOW }),
      new AppError('UNAUTHENTICATED'),
    ],
    [
      'a booking paid meanwhile',
      () => bookings.lockForUpdate.mockResolvedValue([row({ status: 'confirmed' })]),
      new AppError('ALREADY_PAID'),
    ],
    [
      'a hold that ends now',
      () => bookings.lockForUpdate.mockResolvedValue([row({ hold_expires_at: NOW })]),
      new AppError('HOLD_EXPIRED'),
    ],
    [
      'a processing payment',
      () => payments.processingSaleBookingIds.mockResolvedValue(new Set([100])),
      new AppError('PAYMENT_IN_PROGRESS'),
    ],
    [
      'a claim lost to another booking',
      () =>
        seatClaims.lockFor.mockResolvedValue([
          LIVE_CLAIMS[0],
          { ...LIVE_CLAIMS[1], booking_id: 101 },
        ]),
      new AppError('HOLD_EXPIRED'),
    ],
    [
      'a missing claim',
      () => seatClaims.lockFor.mockResolvedValue([LIVE_CLAIMS[0]]),
      new AppError('HOLD_EXPIRED'),
    ],
    [
      'an ended claim',
      () =>
        seatClaims.lockFor.mockResolvedValue([
          LIVE_CLAIMS[0],
          { ...LIVE_CLAIMS[1], claimed_until: NOW },
        ]),
      new AppError('HOLD_EXPIRED'),
    ],
  ])('refuses %s before charging anything', async (_case, arrange, expected) => {
    arrange();
    await expect(service.pay(input)).rejects.toEqual(expected);
    expect(payments.chargeOnline).not.toHaveBeenCalled();
    expect(confirmation.confirm).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('lets a datastore outage through, which the filter answers with 503', async () => {
    showtimes.lockedBookingContext.mockRejectedValue(socketError('ECONNREFUSED'));
    const caught = await service.pay(input).catch((error: unknown) => error);
    expect(resolveException(caught)).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
  });
});
