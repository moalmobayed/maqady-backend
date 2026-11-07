import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { money } from '../../../../src/common/money/money';
import { BookingEditsService } from '../../../../src/modules/bookings/booking-edits.service';
import type { BookingShowtimeService } from '../../../../src/modules/bookings/booking-showtime.service';
import type { BookingViews } from '../../../../src/modules/bookings/booking-views.service';
import type { BookingsRepository } from '../../../../src/modules/bookings/bookings.repository';
import type { TicketsService } from '../../../../src/modules/bookings/tickets.service';
import type { EditBookingInput } from '../../../../src/modules/bookings/types';
import type { HallReadService } from '../../../../src/modules/halls/hall-read.service';
import type { PaymentsService } from '../../../../src/modules/payments/payments.service';
import type { SeatAvailabilityService } from '../../../../src/modules/seating/seat-availability.service';
import type { SeatClaimService } from '../../../../src/modules/seating/seat-claim.service';
import type { SeatEventPublisher } from '../../../../src/modules/seating/seat-event.publisher';
import { ADMIN_NOW, confirmedRow, ledgerEntry } from '../../../support/booking-rows-admin';
import { TestClock } from '../../../support/clock';

const STAFF = { kind: 'staff', id: 3, sessionId: 30, role: 'admin' } as const;
const STARTS = new Date('2026-10-11T16:30:00Z');
const ENDS = new Date('2026-10-11T18:30:00Z');
const PRICES = { front: money(15000), middle: money(19000), back: money(23000) };

/** A showtime context of movie 12, in hall 5, bookable at `ADMIN_NOW`. */
function context(id: number, overrides: Record<string, unknown> = {}) {
  return {
    view: {
      id,
      movieId: 12,
      hallId: 5,
      status: 'scheduled',
      startsAt: STARTS,
      endsAt: ENDS,
      prices: PRICES,
      ...overrides,
    },
    theaterStatus: 'active',
    movieStatus: 'now_showing',
    header: { id },
  };
}

const LAYOUT = {
  seatsPerRow: 4,
  rows: [
    { index: 0, label: 'A', zone: 'front' },
    { index: 1, label: 'B', zone: 'middle' },
    { index: 2, label: 'C', zone: 'middle' },
    { index: 3, label: 'D', zone: 'back' },
  ],
  seatMarks: [],
};

describe('BookingEditsService', () => {
  const calls: string[] = [];
  const logged = <T>(name: string, value: T) =>
    jest.fn((..._args: unknown[]) => {
      calls.push(name);
      return Promise.resolve(value);
    });

  let bookings: Record<
    'findByReference' | 'lockForUpdate' | 'seatsOf' | 'applyEdit' | 'replaceSeats',
    jest.Mock
  >;
  let showtimes: { anyContext: jest.Mock; lockedAnyContext: jest.Mock };
  let halls: Record<'lockForShare' | 'findById' | 'findLayout', jest.Mock>;
  let payments: Record<
    'ledgerOf' | 'refund' | 'recordCounterCharge' | 'findLedgerEntry',
    jest.Mock
  >;
  let seatClaims: Record<'lockFor' | 'deleteOwn' | 'write', jest.Mock>;
  let availability: { snapshot: jest.Mock };
  let events: { publishAfterCommit: jest.Mock };
  let tickets: { queueTickets: jest.Mock };
  let audit: { record: jest.Mock; recordMany: jest.Mock };
  let service: BookingEditsService;

  const seats = [
    {
      booking_id: 100,
      seat_label: 'B2',
      row_label: 'B',
      seat_number: 2,
      zone: 'middle',
      price: 19000,
      is_wheelchair: false,
    },
    {
      booking_id: 100,
      seat_label: 'B3',
      row_label: 'B',
      seat_number: 3,
      zone: 'middle',
      price: 19000,
      is_wheelchair: false,
    },
  ];

  beforeEach(() => {
    calls.length = 0;
    bookings = {
      findByReference: logged('find', confirmedRow()),
      lockForUpdate: logged('lock booking', [confirmedRow()]),
      seatsOf: logged('seats', seats),
      applyEdit: logged('apply', confirmedRow({ qr_version: 2 })),
      replaceSeats: logged('replace seats', undefined),
    };
    showtimes = {
      anyContext: jest.fn((id: number) => Promise.resolve(context(id))),
      lockedAnyContext: jest.fn((id: number) => {
        calls.push(`lock showtime ${id}`);
        return Promise.resolve(context(id));
      }),
    };
    halls = {
      lockForShare: logged('lock hall', { id: 5, status: 'active' }),
      findById: logged('hall', { id: 5, status: 'active' }),
      findLayout: logged('layout', LAYOUT),
    };
    payments = {
      ledgerOf: logged('ledger', [ledgerEntry()]),
      refund: logged('refund', [ledgerEntry({ id: 50, kind: 'refund', refundable: null })]),
      recordCounterCharge: logged('counter charge', {
        id: 51,
        status: 'succeeded',
        method: 'cash',
        purpose: 'edit_difference',
      }),
      findLedgerEntry: logged('find payment', ledgerEntry({ id: 51 })),
    };
    seatClaims = {
      lockFor: logged('lock claims', []),
      deleteOwn: logged('delete claims', []),
      write: logged('claim', { claimed: ['A2', 'A3'], missing: [] }),
    };
    availability = { snapshot: logged('snapshot', { seats: [] }) };
    events = { publishAfterCommit: logged('publish', undefined) };
    tickets = { queueTickets: logged('tickets', undefined) };
    audit = { record: logged('audit', undefined), recordMany: logged('audit', undefined) };
    service = new BookingEditsService(
      bookings as unknown as BookingsRepository,
      showtimes as unknown as BookingShowtimeService,
      halls as unknown as HallReadService,
      payments as unknown as PaymentsService,
      seatClaims as unknown as SeatClaimService,
      availability as unknown as SeatAvailabilityService,
      events as unknown as SeatEventPublisher,
      tickets as unknown as TicketsService,
      { of: logged('view', { reference: 'MQ-7K3P9Q' }) } as unknown as BookingViews,
      audit as unknown as AuditService,
      { run: <T>(work: () => Promise<T>) => work() } as unknown as TransactionRepository,
      new TestClock(ADMIN_NOW),
    );
  });

  const cheaper: EditBookingInput = {
    seats: ['A2', 'A3'],
    reason: 'customer_request',
    notify: false,
  };

  it('takes its locks in the design order, then moves the seats and refunds the difference', async () => {
    const result = await service.apply(STAFF, 'MQ-7K3P9Q', cheaper);

    expect(calls).toEqual([
      'find',
      'lock showtime 81',
      'lock hall',
      'lock booking',
      'seats',
      'ledger',
      'hall',
      'layout',
      'lock claims',
      'delete claims',
      'apply',
      'replace seats',
      'claim',
      'refund',
      'audit',
      'audit',
      'publish',
      'publish',
      'view',
    ]);
    expect(seatClaims.lockFor).toHaveBeenCalledWith([
      { showtimeId: 81, labels: ['B2', 'B3'] },
      { showtimeId: 81, labels: ['A2', 'A3'] },
    ]);
    expect(bookings.applyEdit).toHaveBeenCalledWith(100, {
      showtime_id: 81,
      seat_count: 2,
      total_amount: 30000,
      contact_name: 'Nadia Farouk',
      contact_email: 'nadia@example.com',
      contact_phone: '+201012345678',
      updated_at: ADMIN_NOW,
    });
    expect(seatClaims.write).toHaveBeenCalledWith({
      now: ADMIN_NOW,
      claim: { showtimeId: 81, bookingId: 100, labels: ['A2', 'A3'], claimedUntil: null },
      release: [],
    });
    expect(payments.refund).toHaveBeenCalledWith(
      [{ charge: expect.objectContaining({ id: 7 }), amount: money(8000), reference: 'MQ-7K3P9Q' }],
      'edit_difference',
    );
    expect(result.difference).toEqual({ direction: 'refund', amount: money(8000) });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'booking.edited',
        changedFields: ['seats'],
        metadata: expect.objectContaining({ difference: -8000, reason: 'customer_request' }),
      }),
    );
    expect(events.publishAfterCommit.mock.calls.map((call) => call[0] as unknown)).toEqual([
      { type: 'seat.released', showtimeId: 81, labels: ['B2', 'B3'] },
      { type: 'seat.booked', showtimeId: 81, labels: ['A2', 'A3'] },
    ]);
    expect(tickets.queueTickets).not.toHaveBeenCalled();
  });

  it('locks two showtimes in id order when moving to an earlier id', async () => {
    showtimes.lockedAnyContext = jest.fn((id: number) => {
      calls.push(`lock showtime ${id}`);
      return Promise.resolve(context(id));
    });
    await service.apply(STAFF, 'MQ-7K3P9Q', {
      showtimeId: 70,
      reason: 'showtime_changed',
      notify: true,
    });
    expect(calls.filter((call) => call.startsWith('lock showtime'))).toEqual([
      'lock showtime 70',
      'lock showtime 81',
    ]);
    expect(tickets.queueTickets).toHaveBeenCalledWith([100], { sms: true });
  });

  it('rolls everything back as SEAT_TAKEN when a new seat was taken', async () => {
    seatClaims.write = logged('claim', { claimed: ['A2'], missing: ['A3'] });
    await expect(service.apply(STAFF, 'MQ-7K3P9Q', cheaper)).rejects.toMatchObject({
      code: 'SEAT_TAKEN',
      details: { seats: ['A3'] },
    });
    expect(payments.refund).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('answers CONFLICT when another edit moved the booking between the read and the lock', async () => {
    bookings.lockForUpdate = logged('lock booking', [confirmedRow({ showtime_id: 82 })]);
    await expect(service.apply(STAFF, 'MQ-7K3P9Q', cheaper)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'booking_changed' },
    });
    expect(seatClaims.lockFor).not.toHaveBeenCalled();
  });

  it.each([
    [
      'checked in',
      confirmedRow({ checked_in_at: ADMIN_NOW, checked_in_by_staff_id: 4 }),
      'checked_in',
    ],
    ['refunded', confirmedRow({ status: 'refunded', refunded_at: ADMIN_NOW }), 'not_confirmed'],
  ])('refuses a %s booking before any claim lock', async (_name, row, reason) => {
    bookings.lockForUpdate = logged('lock booking', [row]);
    await expect(service.apply(STAFF, 'MQ-7K3P9Q', cheaper)).rejects.toMatchObject({
      code: 'BOOKING_NOT_EDITABLE',
      details: expect.objectContaining({ reason }),
    });
    expect(seatClaims.lockFor).not.toHaveBeenCalled();
  });

  it('refuses a showtime that started, another movie and an unbookable target', async () => {
    showtimes.lockedAnyContext = jest.fn((id: number) =>
      Promise.resolve(context(id, { startsAt: ADMIN_NOW })),
    );
    await expect(service.apply(STAFF, 'MQ-7K3P9Q', cheaper)).rejects.toMatchObject({
      code: 'BOOKING_NOT_EDITABLE',
      details: { reason: 'started', status: 'confirmed' },
    });
    showtimes.lockedAnyContext = jest.fn((id: number) =>
      Promise.resolve(context(id, id === 90 ? { movieId: 13 } : {})),
    );
    await expect(
      service.apply(STAFF, 'MQ-7K3P9Q', {
        showtimeId: 90,
        reason: 'showtime_changed',
        notify: false,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    showtimes.lockedAnyContext = jest.fn((id: number) =>
      Promise.resolve(context(id, id === 91 ? { status: 'cancelled' } : {})),
    );
    await expect(
      service.apply(STAFF, 'MQ-7K3P9Q', {
        showtimeId: 91,
        reason: 'showtime_changed',
        notify: false,
      }),
    ).rejects.toMatchObject({ code: 'SHOWTIME_NOT_BOOKABLE', details: { reason: 'cancelled' } });
    expect(seatClaims.lockFor).not.toHaveBeenCalled();
  });

  it('takes a higher total at the counter, and requires the payment exactly then', async () => {
    const dearer: EditBookingInput = { seats: ['D2', 'D3'], reason: 'seat_problem', notify: false };
    await expect(service.apply(STAFF, 'MQ-7K3P9Q', dearer)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { fields: [expect.objectContaining({ field: 'payment' })] },
    });
    await expect(
      service.apply(STAFF, 'MQ-7K3P9Q', {
        ...cheaper,
        payment: { method: 'cash', receiptReference: null },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(seatClaims.lockFor).not.toHaveBeenCalled();

    seatClaims.write = logged('claim', { claimed: ['D2', 'D3'], missing: [] });
    const result = await service.apply(STAFF, 'MQ-7K3P9Q', {
      ...dearer,
      payment: { method: 'cash', receiptReference: null },
    });
    expect(payments.recordCounterCharge).toHaveBeenCalledWith({
      bookingId: 100,
      amount: money(8000),
      method: 'cash',
      receiptReference: null,
      purpose: 'edit_difference',
      collectedByStaffId: 3,
    });
    expect(result.difference).toEqual({ direction: 'collect', amount: money(8000) });
    expect(result.payments).toEqual([expect.objectContaining({ id: 51 })]);
  });

  it('previews without locks or writes, and names the seats someone else holds', async () => {
    availability.snapshot = logged('snapshot', {
      seats: [{ label: 'A3' }, { label: 'B2' }, { label: 'C1' }],
    });
    const preview = await service.preview('MQ-7K3P9Q', { ...cheaper, seats: ['A3', 'B2'] });
    expect(preview.unavailableSeats).toEqual(['A3']);
    expect(preview.proposed.total).toEqual(money(34000));
    expect(preview.difference).toEqual({ direction: 'refund', amount: money(4000) });
    expect(showtimes.lockedAnyContext).not.toHaveBeenCalled();
    expect(bookings.lockForUpdate).not.toHaveBeenCalled();
    expect(halls.lockForShare).not.toHaveBeenCalled();
    for (const write of [bookings.applyEdit, seatClaims.write, payments.refund, audit.record]) {
      expect(write).not.toHaveBeenCalled();
    }
  });
});
