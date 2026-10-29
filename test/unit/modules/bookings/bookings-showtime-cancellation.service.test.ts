import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { TransactionContext } from '../../../../src/common/database/transaction-context';
import { money } from '../../../../src/common/money/money';
import type { BookingRefundsService } from '../../../../src/modules/bookings/booking-refunds.service';
import type { BookingShowtimeService } from '../../../../src/modules/bookings/booking-showtime.service';
import { BookingsShowtimeCancellation } from '../../../../src/modules/bookings/bookings-showtime-cancellation.service';
import type { BookingsRepository } from '../../../../src/modules/bookings/bookings.repository';
import type { MessagingService } from '../../../../src/modules/messaging/messaging.service';
import type { PaymentsService } from '../../../../src/modules/payments/payments.service';
import type { SeatClaimService } from '../../../../src/modules/seating/seat-claim.service';
import type { SeatEventPublisher } from '../../../../src/modules/seating/seat-event.publisher';
import { RegisteredShowtimeCancellation } from '../../../../src/modules/showtimes/showtime-cancellation.service';
import type { ShowtimeReadService } from '../../../../src/modules/showtimes/showtime-read.service';
import type { ShowtimeCancellationInput } from '../../../../src/modules/showtimes/types';
import { ADMIN_NOW, confirmedRow, ledgerEntry } from '../../../support/booking-rows-admin';
import { TestClock } from '../../../support/clock';

const LATER = new Date('2026-10-11T19:00:00Z');
const INPUT = {
  showtime: { id: 81 },
  reason: 'technical_issue',
  actor: { kind: 'staff', id: 3, sessionId: 30, role: 'admin' },
} as unknown as ShowtimeCancellationInput;

describe('BookingsShowtimeCancellation', () => {
  const calls: string[] = [];
  const logged = <T>(name: string, value: T) =>
    jest.fn((..._args: unknown[]) => {
      calls.push(name);
      return Promise.resolve(value);
    });

  const card = confirmedRow();
  const walkIn = confirmedRow({
    id: 101,
    reference: 'MQ-22222A',
    channel: 'counter',
    customer_id: null,
    created_by_staff_id: 4,
    contact_name: null,
    contact_email: null,
    contact_phone: null,
  });
  const hold = confirmedRow({
    id: 102,
    reference: 'MQ-33333B',
    status: 'held',
    confirmed_at: null,
    qr_version: null,
    hold_expires_at: LATER,
  });
  const elsewhere = confirmedRow({ id: 103, showtime_id: 82 });

  let bookings: Record<
    'confirmedOrLiveHeldIdsOf' | 'lockForUpdate' | 'seatsOf' | 'expireHolds' | 'findByIds',
    jest.Mock
  >;
  let refunds: { refundLocked: jest.Mock };
  let seatClaims: { lockFor: jest.Mock; deleteOwn: jest.Mock };
  let messaging: { queueMany: jest.Mock };
  let audit: { recordMany: jest.Mock };
  let payments: { ledgerOf: jest.Mock };
  let showtimes: { findById: jest.Mock };
  let active: boolean;
  let registry: RegisteredShowtimeCancellation;
  let service: BookingsShowtimeCancellation;

  beforeEach(() => {
    calls.length = 0;
    active = true;
    bookings = {
      confirmedOrLiveHeldIdsOf: logged('ids', [100, 101, 102, 103]),
      lockForUpdate: logged('lock bookings', [card, walkIn, hold, elsewhere]),
      seatsOf: logged('seats', [
        { booking_id: 100, seat_label: 'B2' },
        { booking_id: 100, seat_label: 'B3' },
        { booking_id: 101, seat_label: 'A2' },
        { booking_id: 102, seat_label: 'C5' },
      ]),
      expireHolds: logged('expire holds', undefined),
      findByIds: logged('find', [card, walkIn, hold]),
    };
    refunds = {
      refundLocked: jest.fn((rows: (typeof card)[]) => {
        calls.push('refund');
        return Promise.resolve(
          rows.map((row) => ({
            row,
            refunds: [
              ledgerEntry({
                bookingId: row.id,
                kind: 'refund',
                method: row.channel === 'counter' ? 'cash' : 'card',
                status: row.channel === 'counter' ? 'pending' : 'succeeded',
                amount: money(row.total_amount),
                refundable: null,
              }),
            ],
          })),
        );
      }),
    };
    seatClaims = {
      lockFor: logged('lock claims', []),
      deleteOwn: logged('delete hold claims', [{ showtimeId: 81, labels: ['C5'] }]),
    };
    messaging = { queueMany: logged('queue', []) };
    audit = { recordMany: logged('audit', undefined) };
    payments = {
      ledgerOf: logged('ledger', [
        ledgerEntry({ refundable: money(38000) }),
        ledgerEntry({
          id: 8,
          bookingId: 101,
          method: 'cash',
          providerReference: null,
          amount: money(15000),
          refundable: money(15000),
        }),
      ]),
    };
    showtimes = {
      findById: logged('showtime', {
        id: 81,
        status: 'scheduled',
        endsAt: LATER,
        prices: { front: money(15000) },
      }),
    };
    registry = new RegisteredShowtimeCancellation();
    service = new BookingsShowtimeCancellation(
      registry,
      bookings as unknown as BookingsRepository,
      refunds as unknown as BookingRefundsService,
      showtimes as unknown as ShowtimeReadService,
      {
        headersOf: logged(
          'headers',
          new Map([
            [
              81,
              {
                startsAt: LATER,
                movie: { title: 'The Nile Light' },
                theater: { name: 'Maqady Zamalek' },
                hall: { name: 'Hall 3' },
              },
            ],
          ]),
        ),
      } as unknown as BookingShowtimeService,
      payments as unknown as PaymentsService,
      seatClaims as unknown as SeatClaimService,
      { publishAfterCommit: logged('publish', undefined) } as unknown as SeatEventPublisher,
      messaging as unknown as MessagingService,
      audit as unknown as AuditService,
      { isActive: () => active } as unknown as TransactionContext,
      new TestClock(ADMIN_NOW),
    );
  });

  it('registers itself as the showtimes seam at boot', async () => {
    service.onModuleInit();
    const outcome = await registry.cancelBookings(INPUT);
    expect(outcome.refundedBookingCount).toBe(2);
  });

  it('locks the bookings, then every claim, before refunding, releasing and notifying', async () => {
    const outcome = await service.cancelBookings(INPUT);

    expect(calls).toEqual([
      'ids',
      'lock bookings',
      'seats',
      'lock claims',
      'refund',
      'expire holds',
      'delete hold claims',
      'audit',
      'publish',
      'headers',
      'queue',
    ]);
    expect(bookings.confirmedOrLiveHeldIdsOf).toHaveBeenCalledWith(81, ADMIN_NOW);
    expect(seatClaims.lockFor).toHaveBeenCalledWith([
      { showtimeId: 81, labels: ['B2', 'B3', 'A2', 'C5'] },
    ]);
    // A booking moved to another showtime meanwhile is not this showtime's.
    expect(refunds.refundLocked).toHaveBeenCalledWith([card, walkIn], {
      actor: { kind: 'staff', id: 3 },
      now: ADMIN_NOW,
      reason: 'showtime_cancelled',
      notify: false,
    });
    expect(bookings.expireHolds).toHaveBeenCalledWith([102], ADMIN_NOW);
    const [inputs] = messaging.queueMany.mock.calls[0] as [
      { template: { name: string }; recipient: string; params: Record<string, unknown> }[],
    ];
    // One email and one SMS for the card booking; the walk-in has no contact.
    expect(inputs.map((input) => [input.template.name, input.recipient])).toEqual([
      ['showtime.cancelled', 'nadia@example.com'],
      ['showtime.cancelled_sms', '+201012345678'],
    ]);
    expect(inputs[0]!.params).toMatchObject({
      reference: 'MQ-7K3P9Q',
      movieTitle: 'The Nile Light',
      hallName: 'Hall 3',
      amount: 'EGP 380',
      onlineAmount: 'EGP 380',
      counterAmount: null,
    });
    expect(outcome).toEqual({ refundedBookingCount: 2, releasedHoldCount: 1, notifiedCount: 1 });
  });

  it('does nothing for a showtime without bookings, and needs the transaction', async () => {
    bookings.confirmedOrLiveHeldIdsOf = logged('ids', []);
    expect(await service.cancelBookings(INPUT)).toEqual({
      refundedBookingCount: 0,
      releasedHoldCount: 0,
      notifiedCount: 0,
    });
    expect(bookings.lockForUpdate).not.toHaveBeenCalled();
    active = false;
    await expect(service.cancelBookings(INPUT)).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('previews the figures without locks', async () => {
    expect(await service.preview(81)).toEqual({
      showtimeId: 81,
      cancellable: true,
      bookingCount: 2,
      seatCount: 4,
      refundedOnline: money(38000),
      owedAtCounter: money(15000),
      liveHoldCount: 1,
      emailCount: 1,
      smsCount: 1,
    });
    expect(bookings.lockForUpdate).not.toHaveBeenCalled();
    showtimes.findById = logged('showtime', null);
    await expect(service.preview(99)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
