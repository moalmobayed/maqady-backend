import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { sha256Hex } from '../../../../src/common/crypto/hashing';
import { AppError } from '../../../../src/common/errors/app-error';
import { resolveException } from '../../../../src/common/errors/error-mapping';
import { money } from '../../../../src/common/money/money';
import { toBooking } from '../../../../src/modules/bookings/booking-assembly';
import type { BookingShowtimeService } from '../../../../src/modules/bookings/booking-showtime.service';
import type { BookingViews } from '../../../../src/modules/bookings/booking-views.service';
import type { BookingsRepository } from '../../../../src/modules/bookings/bookings.repository';
import { newHoldCode } from '../../../../src/modules/bookings/hold-code';
import { HoldsService } from '../../../../src/modules/bookings/holds.service';
import type {
  BookingRow,
  NewBookingRow,
  ShowtimeContext,
} from '../../../../src/modules/bookings/types';
import type { CustomerService } from '../../../../src/modules/customers/customer.service';
import type { Customer } from '../../../../src/modules/customers/types';
import type { HallReadService } from '../../../../src/modules/halls/hall-read.service';
import type { HallLayout, HallSummary } from '../../../../src/modules/halls/types';
import type { PaymentsService } from '../../../../src/modules/payments/payments.service';
import type { HoldRefusalService } from '../../../../src/modules/seating/hold-refusal.service';
import type { SeatClaimService } from '../../../../src/modules/seating/seat-claim.service';
import type { SeatEventPublisher } from '../../../../src/modules/seating/seat-event.publisher';
import type { ClaimPlan } from '../../../../src/modules/seating/types';
import { TestClock } from '../../../support/clock';
import { socketError } from '../../../support/errors';

const NOW = new Date('2026-10-16T19:00:00+03:00');
const STARTS_AT = new Date('2026-10-16T21:00:00+03:00');
const FIVE_MINUTES_LATER = new Date('2026-10-16T19:05:00+03:00');
const PRICES = { front: money(15000), middle: money(19000), back: money(23000) };

const CONTEXT: ShowtimeContext = {
  view: {
    id: 81,
    movieId: 9,
    theaterId: 2,
    hallId: 5,
    hallName: 'Hall 1',
    startsAt: STARTS_AT,
    endsAt: new Date('2026-10-16T23:00:00+03:00'),
    cleaningEndsAt: new Date('2026-10-16T23:20:00+03:00'),
    cinemaDate: '2026-10-16',
    status: 'scheduled',
    cancelReason: null,
    cancelledAt: null,
    prices: PRICES,
    fromPrice: PRICES.front,
    seatCapacity: 31,
    createdAt: NOW,
    updatedAt: NOW,
  },
  theaterStatus: 'active',
  movieStatus: 'now_showing',
  header: {
    id: 81,
    startsAt: STARTS_AT,
    endsAt: new Date('2026-10-16T23:00:00+03:00'),
    cinemaDate: '2026-10-16',
    movie: { id: 9, title: 'The Nile Light', ageRating: '12+', runtimeMinutes: 120, poster: null },
    theater: {
      id: 2,
      name: 'Zamalek',
      address: '26 July St',
      district: 'Zamalek',
      city: 'Cairo',
      latitude: 30.06,
      longitude: 31.22,
    },
    hall: { id: 5, name: 'Hall 1' },
  },
};

const HALL = { id: 5, status: 'active' } as HallSummary;
/** 4 rows of 8: A front, B and C middle, D back; A1 a wheelchair space, D8 a gap. */
const LAYOUT = {
  hallId: 5,
  seatsPerRow: 8,
  rows: [
    { index: 0, label: 'A', zone: 'front' },
    { index: 1, label: 'B', zone: 'middle' },
    { index: 2, label: 'C', zone: 'middle' },
    { index: 3, label: 'D', zone: 'back' },
  ],
  seatMarks: [
    { rowLabel: 'A', seatNumber: 1, kind: 'wheelchair' },
    { rowLabel: 'D', seatNumber: 8, kind: 'no_seat' },
  ],
} as unknown as HallLayout;

const CUSTOMER: Customer = {
  id: 12,
  email: 'mona@example.com',
  fullName: 'Mona Adel',
  phone: '+201012345678',
  status: 'active',
  emailVerifiedAt: NOW,
  lastSignInAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};

function bookingRow(overrides: Partial<BookingRow>): BookingRow {
  return {
    id: 100,
    reference: 'MQ-7K3P9Q',
    showtime_id: 81,
    status: 'held',
    channel: 'online',
    customer_id: null,
    created_by_staff_id: null,
    hold_token_hash: null,
    hold_expires_at: FIVE_MINUTES_LATER,
    has_declined_payment: false,
    seat_count: 1,
    total_amount: 19000,
    currency: 'EGP',
    contact_name: null,
    contact_email: null,
    contact_phone: null,
    confirmed_at: null,
    refunded_at: null,
    qr_version: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

describe('HoldsService', () => {
  const calls: string[] = [];
  const logged = <T>(name: string, value: T) =>
    jest.fn(() => {
      calls.push(name);
      return Promise.resolve(value);
    });

  let bookings: Record<keyof BookingsRepository, jest.Mock>;
  let showtimes: { lockedContext: jest.Mock };
  let halls: { lockForShare: jest.Mock; findLayout: jest.Mock };
  let customers: { findByIdForUpdate: jest.Mock };
  let seatClaims: { write: jest.Mock };
  let refusals: { recordAfterRollback: jest.Mock };
  let events: { publishAfterCommit: jest.Mock };
  let audit: { record: jest.Mock };
  let payments: { processingSaleBookingIds: jest.Mock };
  let views: { of: jest.Mock };
  let clock: TestClock;
  let service: HoldsService;

  beforeEach(() => {
    calls.length = 0;
    clock = new TestClock(NOW);
    bookings = {
      insertUnlessReferenceTaken: jest.fn((row: NewBookingRow, reference: string) => {
        calls.push('insert booking');
        return Promise.resolve(bookingRow({ ...row, reference, id: 200 }));
      }),
      insertSeats: logged('insert seats', undefined),
      findByReference: logged('find', undefined),
      liveOnlineHoldIdsOfCustomer: logged('customer holds', []),
      liveUnownedHoldIdByCodeHash: logged('code hold', undefined),
      lockForUpdate: logged('lock bookings', []),
      seatsOf: logged('seats of', []),
      expireHolds: logged('expire', undefined),
      assignOwner: logged('assign', undefined),
      findByIds: logged('find by ids', []),
      confirm: logged('confirm', []),
      markDeclined: logged('mark declined', undefined),
      extendHold: logged('extend', undefined),
      markRefunded: logged('mark refunded', undefined),
      ticketHoldersOf: logged('ticket holders', []),
      pageForCustomer: logged('page for customer', []),
      tabCountsOfCustomer: logged('tab counts', { upcoming: 0, past: 0 }),
      countConfirmedOfCustomer: logged('count confirmed', 0),
    };
    showtimes = {
      lockedContext: logged('lock showtime', CONTEXT),
    };
    halls = { lockForShare: logged('lock hall', HALL), findLayout: logged('layout', LAYOUT) };
    customers = { findByIdForUpdate: logged('lock customer', CUSTOMER) };
    seatClaims = {
      write: jest.fn((plan: ClaimPlan) => {
        calls.push('claim seats');
        return Promise.resolve({ claimed: [...(plan.claim?.labels ?? [])].sort(), missing: [] });
      }),
    };
    refusals = { recordAfterRollback: logged('record refusal', undefined) };
    events = { publishAfterCommit: logged('publish', undefined) };
    audit = { record: logged('audit', 1) };
    payments = { processingSaleBookingIds: jest.fn().mockResolvedValue(new Set()) };
    views = {
      of: jest.fn((row: BookingRow, now: Date) =>
        Promise.resolve(
          toBooking({
            row,
            seats: [],
            showtime: CONTEXT.header,
            latestSale: null,
            qrCode: null,
            now,
          }),
        ),
      ),
    };
    const transactions = { run: jest.fn((fn: () => Promise<unknown>) => fn()) };
    service = new HoldsService(
      bookings as unknown as BookingsRepository,
      showtimes as unknown as BookingShowtimeService,
      halls as unknown as HallReadService,
      customers as unknown as CustomerService,
      seatClaims as unknown as SeatClaimService,
      refusals as unknown as HoldRefusalService,
      events as unknown as SeatEventPublisher,
      transactions as unknown as TransactionRepository,
      audit as unknown as AuditService,
      clock,
      views as unknown as BookingViews,
      payments as unknown as PaymentsService,
    );
  });

  it('holds a guest seat set under the lock order, priced by zone, with a code returned once', async () => {
    const hold = await service.create({
      showtimeId: 81,
      labels: ['B2', 'A1'],
      holder: { kind: 'guest' },
    });

    expect(calls).toEqual([
      'lock showtime',
      'lock hall',
      'layout',
      'insert booking',
      'insert seats',
      'claim seats',
      'audit',
      'publish',
    ]);
    const [row] = bookings.insertUnlessReferenceTaken.mock.calls[0] as [NewBookingRow, string];
    expect(hold.holdCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row).toMatchObject({
      showtime_id: 81,
      status: 'held',
      channel: 'online',
      customer_id: null,
      hold_token_hash: sha256Hex(hold.holdCode!),
      hold_expires_at: FIVE_MINUTES_LATER,
      seat_count: 2,
      total_amount: 15000 + 19000,
      contact_email: null,
    });
    expect(bookings.insertSeats).toHaveBeenCalledWith([
      expect.objectContaining({
        seat_label: 'A1',
        zone: 'front',
        price: 15000,
        is_wheelchair: true,
      }),
      expect.objectContaining({
        seat_label: 'B2',
        zone: 'middle',
        price: 19000,
        is_wheelchair: false,
      }),
    ]);
    expect(seatClaims.write).toHaveBeenCalledWith({
      now: NOW,
      claim: {
        showtimeId: 81,
        bookingId: 200,
        labels: ['A1', 'B2'],
        claimedUntil: FIVE_MINUTES_LATER,
      },
      release: [],
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { kind: 'system' },
        action: 'booking.held',
        bookingId: 200,
        metadata: { showtimeId: 81, seatCount: 2, channel: 'online', holder: 'guest' },
      }),
    );
    expect(events.publishAfterCommit).toHaveBeenCalledWith({
      type: 'seat.held',
      showtimeId: 81,
      labels: ['A1', 'B2'],
      heldUntil: FIVE_MINUTES_LATER,
    });
    expect(hold.booking).toMatchObject({ status: 'held', owner: 'guest', total: money(34000) });
  });

  it('locks the customer, then releases their live hold in the same claim statement', async () => {
    const previous = bookingRow({ id: 90, customer_id: 12, showtime_id: 81 });
    bookings.liveOnlineHoldIdsOfCustomer.mockImplementation(() => {
      calls.push('customer holds');
      return Promise.resolve([90]);
    });
    bookings.lockForUpdate.mockImplementation(() => {
      calls.push('lock bookings');
      return Promise.resolve([previous]);
    });
    bookings.seatsOf.mockResolvedValue([
      {
        booking_id: 90,
        seat_label: 'B2',
        row_label: 'B',
        seat_number: 2,
        zone: 'middle',
        price: 19000,
        is_wheelchair: false,
      },
      {
        booking_id: 90,
        seat_label: 'B3',
        row_label: 'B',
        seat_number: 3,
        zone: 'middle',
        price: 19000,
        is_wheelchair: false,
      },
    ]);

    const hold = await service.create({
      showtimeId: 81,
      labels: ['B3', 'B4'],
      holder: { kind: 'customer', customerId: 12 },
    });

    expect(calls.slice(0, 7)).toEqual([
      'lock showtime',
      'lock hall',
      'layout',
      'lock customer',
      'customer holds',
      'lock bookings',
      'expire',
    ]);
    expect(bookings.expireHolds).toHaveBeenCalledWith([90], NOW);
    expect(seatClaims.write).toHaveBeenCalledWith(
      expect.objectContaining({
        release: [{ showtimeId: 81, bookingId: 90, labels: ['B2', 'B3'] }],
      }),
    );
    expect(hold.holdCode).toBeNull();
    const [row] = bookings.insertUnlessReferenceTaken.mock.calls[0] as [NewBookingRow, string];
    expect(row).toMatchObject({
      customer_id: 12,
      hold_token_hash: null,
      contact_name: 'Mona Adel',
      contact_email: 'mona@example.com',
      contact_phone: '+201012345678',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { kind: 'customer', id: 12 },
        action: 'booking.released',
        bookingId: 90,
        metadata: { showtimeId: 81, reason: 'replaced', holder: 'customer' },
      }),
    );
    // B3 is held again by the new hold, so only B2 is announced free.
    expect(events.publishAfterCommit).toHaveBeenCalledWith({
      type: 'seat.released',
      showtimeId: 81,
      labels: ['B2'],
    });
  });

  it('releases the guest hold a presented code names, checked again under the lock', async () => {
    const { code, hash } = newHoldCode();
    bookings.liveUnownedHoldIdByCodeHash.mockResolvedValue(70);
    bookings.lockForUpdate.mockResolvedValue([bookingRow({ id: 70, hold_token_hash: hash })]);
    await service.create({
      showtimeId: 81,
      labels: ['C1'],
      holder: { kind: 'guest', holdCode: code },
    });
    expect(bookings.liveUnownedHoldIdByCodeHash).toHaveBeenCalledWith(hash, NOW);
    expect(bookings.expireHolds).toHaveBeenCalledWith([70], NOW);

    // Claimed by someone else between the read and the lock: left alone.
    bookings.expireHolds.mockClear();
    bookings.lockForUpdate.mockResolvedValue([bookingRow({ id: 70, customer_id: 44 })]);
    await service.create({
      showtimeId: 81,
      labels: ['C1'],
      holder: { kind: 'guest', holdCode: code },
    });
    expect(bookings.expireHolds).not.toHaveBeenCalled();
  });

  it('refuses taken seats: registers the refusal for after the rollback and publishes nothing', async () => {
    seatClaims.write.mockResolvedValue({ claimed: ['A2'], missing: ['A3'] });
    const caught = await service
      .create({ showtimeId: 81, labels: ['A3', 'A2'], holder: { kind: 'guest' } })
      .catch((error: unknown) => error);
    expect(caught).toEqual(new AppError('SEAT_TAKEN', undefined, { seats: ['A3'] }));
    expect((caught as AppError).details).toEqual({ seats: ['A3'] });
    expect(refusals.recordAfterRollback).toHaveBeenCalledWith(81, 2);
    expect(events.publishAfterCommit).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('never lets a hold outlive the start of its showtime', async () => {
    clock.set(new Date(STARTS_AT.getTime() - 3 * 60_000));
    await service.create({ showtimeId: 81, labels: ['A2'], holder: { kind: 'guest' } });
    const [row] = bookings.insertUnlessReferenceTaken.mock.calls[0] as [NewBookingRow, string];
    expect(row.hold_expires_at).toEqual(STARTS_AT);
  });

  it('draws a new reference on a collision, and gives up after 5 draws', async () => {
    bookings.insertUnlessReferenceTaken.mockResolvedValue(undefined);
    await expect(
      service.create({ showtimeId: 81, labels: ['A2'], holder: { kind: 'guest' } }),
    ).rejects.toEqual(new AppError('INTERNAL', 'No free booking reference was drawn.'));
    expect(bookings.insertUnlessReferenceTaken).toHaveBeenCalledTimes(5);
    const references = bookings.insertUnlessReferenceTaken.mock.calls.map(
      ([, ref]) => ref as string,
    );
    expect(new Set(references).size).toBeGreaterThan(1);
    expect(seatClaims.write).not.toHaveBeenCalled();
  });

  it('refuses a showtime that cannot be held, and seats not in the layout, before writing', async () => {
    showtimes.lockedContext.mockResolvedValue({ ...CONTEXT, theaterStatus: 'sales_paused' });
    await expect(
      service.create({ showtimeId: 81, labels: ['A2'], holder: { kind: 'guest' } }),
    ).rejects.toEqual(new AppError('SHOWTIME_NOT_BOOKABLE', undefined, { reason: 'sales_paused' }));

    showtimes.lockedContext.mockResolvedValue(CONTEXT);
    const caught = (await service
      .create({ showtimeId: 81, labels: ['A2', 'D8', 'E1'], holder: { kind: 'guest' } })
      .catch((error: unknown) => error)) as AppError;
    expect(caught.code).toBe('VALIDATION_FAILED');
    expect(caught.details).toEqual({
      fields: [
        { field: 'seats.1', messages: ['Not a seat in this hall.'] },
        { field: 'seats.2', messages: ['Not a seat in this hall.'] },
      ],
    });

    showtimes.lockedContext.mockResolvedValue(null);
    await expect(
      service.create({ showtimeId: 81, labels: ['A2'], holder: { kind: 'guest' } }),
    ).rejects.toEqual(new AppError('NOT_FOUND'));
    expect(bookings.insertUnlessReferenceTaken).not.toHaveBeenCalled();
  });

  it('refuses a blocked or anonymised customer', async () => {
    customers.findByIdForUpdate.mockResolvedValue({ ...CUSTOMER, status: 'blocked' });
    await expect(
      service.create({
        showtimeId: 81,
        labels: ['A2'],
        holder: { kind: 'customer', customerId: 12 },
      }),
    ).rejects.toEqual(new AppError('ACCOUNT_BLOCKED'));
    customers.findByIdForUpdate.mockResolvedValue({ ...CUSTOMER, deletedAt: NOW });
    await expect(
      service.create({
        showtimeId: 81,
        labels: ['A2'],
        holder: { kind: 'customer', customerId: 12 },
      }),
    ).rejects.toEqual(new AppError('UNAUTHENTICATED'));
  });

  it('lets a datastore outage through, which the filter answers with 503', async () => {
    showtimes.lockedContext.mockRejectedValue(socketError('ECONNREFUSED'));
    const caught = await service
      .create({ showtimeId: 81, labels: ['A2'], holder: { kind: 'guest' } })
      .catch((error: unknown) => error);
    expect(resolveException(caught)).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
  });

  describe('claim', () => {
    const PRINCIPAL = { kind: 'customer', id: 12, sessionId: 3 } as const;

    it('gives the guest hold to the customer, clears its code and keeps its expiry', async () => {
      const { code, hash } = newHoldCode();
      const guestHold = bookingRow({ id: 70, hold_token_hash: hash });
      bookings.findByReference.mockResolvedValue(guestHold);
      bookings.lockForUpdate.mockResolvedValue([guestHold]);
      bookings.assignOwner.mockResolvedValue({
        ...guestHold,
        customer_id: 12,
        hold_token_hash: null,
      });

      const booking = await service.claim(PRINCIPAL, 'MQ-7K3P9Q', code);
      const order = [
        customers.findByIdForUpdate,
        bookings.findByReference,
        bookings.liveOnlineHoldIdsOfCustomer,
        bookings.lockForUpdate,
        bookings.assignOwner,
        audit.record,
      ].map((mock) => mock.mock.invocationCallOrder[0]);
      expect(order).toEqual([...order].sort((a, b) => a! - b!));
      expect(bookings.assignOwner).toHaveBeenCalledWith(70, {
        customer_id: 12,
        hold_token_hash: null,
        contact_name: 'Mona Adel',
        contact_email: 'mona@example.com',
        contact_phone: '+201012345678',
        updated_at: NOW,
      });
      expect(booking).toMatchObject({ owner: 'customer', holdExpiresAt: FIVE_MINUTES_LATER });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'booking.claimed', actor: { kind: 'customer', id: 12 } }),
      );
    });

    it('answers NOT_FOUND for a wrong code or someone else’s booking, HOLD_EXPIRED for an ended one', async () => {
      const { code, hash } = newHoldCode();
      bookings.findByReference.mockResolvedValue(bookingRow({ hold_token_hash: hash }));
      await expect(service.claim(PRINCIPAL, 'MQ-7K3P9Q', newHoldCode().code)).rejects.toEqual(
        new AppError('NOT_FOUND'),
      );
      bookings.findByReference.mockResolvedValue(bookingRow({ customer_id: 44 }));
      await expect(service.claim(PRINCIPAL, 'MQ-7K3P9Q', code)).rejects.toEqual(
        new AppError('NOT_FOUND'),
      );

      const ended = bookingRow({ hold_token_hash: hash, hold_expires_at: NOW });
      bookings.findByReference.mockResolvedValue(ended);
      bookings.lockForUpdate.mockResolvedValue([ended]);
      await expect(service.claim(PRINCIPAL, 'MQ-7K3P9Q', code)).rejects.toEqual(
        new AppError('HOLD_EXPIRED'),
      );
      expect(bookings.assignOwner).not.toHaveBeenCalled();
    });
  });

  describe('release', () => {
    it('ends a live hold of its owner now and frees its seats', async () => {
      const own = bookingRow({ id: 90, customer_id: 12 });
      bookings.findByReference.mockResolvedValue(own);
      bookings.lockForUpdate.mockResolvedValue([own]);
      bookings.seatsOf.mockResolvedValue([
        {
          booking_id: 90,
          seat_label: 'B2',
          row_label: 'B',
          seat_number: 2,
          zone: 'middle',
          price: 19000,
          is_wheelchair: false,
        },
      ]);
      await service.release({ customerId: 12 }, own.reference);
      expect(bookings.expireHolds).toHaveBeenCalledWith([90], NOW);
      expect(seatClaims.write).toHaveBeenCalledWith({
        now: NOW,
        release: [{ showtimeId: 81, bookingId: 90, labels: ['B2'] }],
      });
      expect(events.publishAfterCommit).toHaveBeenCalledWith({
        type: 'seat.released',
        showtimeId: 81,
        labels: ['B2'],
      });
    });

    it('changes nothing for an ended hold, refuses a paid booking and hides others’ bookings', async () => {
      bookings.findByReference.mockResolvedValue(
        bookingRow({ customer_id: 12, hold_expires_at: NOW }),
      );
      bookings.lockForUpdate.mockResolvedValue([
        bookingRow({ customer_id: 12, hold_expires_at: NOW }),
      ]);
      await service.release({ customerId: 12 }, 'MQ-7K3P9Q');
      expect(bookings.expireHolds).not.toHaveBeenCalled();

      const paid = bookingRow({ customer_id: 12, status: 'confirmed', confirmed_at: NOW });
      bookings.findByReference.mockResolvedValue(paid);
      bookings.lockForUpdate.mockResolvedValue([paid]);
      await expect(service.release({ customerId: 12 }, 'MQ-7K3P9Q')).rejects.toEqual(
        new AppError('ALREADY_PAID'),
      );
      await expect(service.release({ customerId: 13 }, 'MQ-7K3P9Q')).rejects.toEqual(
        new AppError('NOT_FOUND'),
      );
      await expect(service.release({}, 'MQ-7K3P9Q')).rejects.toEqual(new AppError('NOT_FOUND'));
    });
  });

  describe('a hold whose payment is processing (U11)', () => {
    const processing = bookingRow({ id: 90, customer_id: 12 });

    beforeEach(() => {
      payments.processingSaleBookingIds.mockResolvedValue(new Set([90]));
      bookings.lockForUpdate.mockResolvedValue([processing]);
    });

    it('is never released: PAYMENT_IN_PROGRESS, checked under the booking lock, nothing written', async () => {
      bookings.findByReference.mockResolvedValue(processing);
      await expect(service.release({ customerId: 12 }, processing.reference)).rejects.toEqual(
        new AppError('PAYMENT_IN_PROGRESS'),
      );
      expect(payments.processingSaleBookingIds).toHaveBeenCalledWith([90]);
      expect(bookings.lockForUpdate.mock.invocationCallOrder[0]).toBeLessThan(
        payments.processingSaleBookingIds.mock.invocationCallOrder[0]!,
      );
      expect(bookings.expireHolds).not.toHaveBeenCalled();
      expect(seatClaims.write).not.toHaveBeenCalled();
    });

    it('is never replaced by a new hold of its customer', async () => {
      bookings.liveOnlineHoldIdsOfCustomer.mockResolvedValue([90]);
      await expect(
        service.create({
          showtimeId: 81,
          labels: ['A2'],
          holder: { kind: 'customer', customerId: 12 },
        }),
      ).rejects.toEqual(new AppError('PAYMENT_IN_PROGRESS'));
      expect(bookings.expireHolds).not.toHaveBeenCalled();
      expect(bookings.insertUnlessReferenceTaken).not.toHaveBeenCalled();
    });

    it('is never released by claiming a guest hold', async () => {
      const { code, hash } = newHoldCode();
      const guestHold = bookingRow({ id: 70, hold_token_hash: hash });
      bookings.findByReference.mockResolvedValue(guestHold);
      bookings.liveOnlineHoldIdsOfCustomer.mockResolvedValue([90]);
      bookings.lockForUpdate.mockResolvedValue([guestHold, processing]);
      await expect(
        service.claim({ kind: 'customer', id: 12, sessionId: 3 }, 'MQ-7K3P9Q', code),
      ).rejects.toEqual(new AppError('PAYMENT_IN_PROGRESS'));
      expect(bookings.assignOwner).not.toHaveBeenCalled();
    });
  });
});
