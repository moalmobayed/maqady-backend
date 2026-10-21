import { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { addToInstant } from '../../../../src/common/time/time';
import { SeatAvailabilityService } from '../../../../src/modules/seating/seat-availability.service';
import { SeatClaimService } from '../../../../src/modules/seating/seat-claim.service';
import { TestClock } from '../../../support/clock';
import { bookableShowtime, heldBookingIds } from '../../../support/holds';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { BookableShowtimeFixture, TestApp } from '../../../support/types';

const NOW = new Date('2026-10-10T10:00:00+03:00');
const IN_FIVE = addToInstant(NOW, { minutes: 5 });

/**
 * The claim statement itself (design §7.2), against real Postgres: called directly inside a
 * transaction, on real bookings made through the hold route (A1, A2, A3 held from NOW for
 * 5 minutes).
 */
describe('The seat claim statement (integration)', () => {
  let testApp: TestApp;
  let showtime: BookableShowtimeFixture;
  let bookings: number[];
  const clock = new TestClock(NOW);

  const write = (plan: Parameters<SeatClaimService['write']>[0]) =>
    testApp.app.get(TransactionRepository).run(() => testApp.app.get(SeatClaimService).write(plan));
  const claimsOf = async () =>
    testApp
      .knex('seat_claims')
      .select<{ seat_label: string; booking_id: number; claimed_until: Date | null }[]>(
        'seat_label',
        'booking_id',
        'claimed_until',
      )
      .where({ showtime_id: showtime.showtimeId })
      .orderBy('seat_label');

  beforeAll(async () => {
    testApp = await createTestApp({ clock });
    const admin = await staffSession(testApp, 'admin');
    showtime = await bookableShowtime(testApp, admin);
  });

  beforeEach(async () => {
    clock.set(NOW);
    await testApp.knex.raw(
      'TRUNCATE seat_claims, booking_seats, bookings, hold_refusals, audit_events CASCADE',
    );
    bookings = await heldBookingIds(testApp, showtime.showtimeId, 3);
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('inserts a free seat, refuses a live one and takes over one whose claim ended', async () => {
    const [first, second] = bookings as [number, number, number];
    expect(
      await write({
        now: NOW,
        claim: {
          showtimeId: showtime.showtimeId,
          bookingId: second,
          labels: ['B1', 'A1'],
          claimedUntil: IN_FIVE,
        },
        release: [],
      }),
    ).toEqual({ claimed: ['B1'], missing: ['A1'] });

    // At its expiry (claimed_until <= now) A1 is free, with no job having run.
    const later = addToInstant(NOW, { minutes: 5 });
    const until = addToInstant(later, { minutes: 5 });
    expect(
      await write({
        now: later,
        claim: {
          showtimeId: showtime.showtimeId,
          bookingId: second,
          labels: ['A1'],
          claimedUntil: until,
        },
        release: [],
      }),
    ).toEqual({ claimed: ['A1'], missing: [] });
    const rows = await claimsOf();
    expect(rows.find((row) => row.seat_label === 'A1')).toEqual({
      seat_label: 'A1',
      booking_id: second,
      claimed_until: until,
    });
    expect(rows.find((row) => row.seat_label === 'B1')?.booking_id).toBe(second);
    expect(first).toBeDefined();
  });

  it('never touches a sold seat, not by a release, a take-over or an expiry', async () => {
    const [first, second] = bookings as [number, number, number];
    await testApp.knex('seat_claims').where({ booking_id: first }).update({ claimed_until: null });
    const farLater = addToInstant(NOW, { hours: 3 });
    expect(
      await write({
        now: farLater,
        claim: {
          showtimeId: showtime.showtimeId,
          bookingId: second,
          labels: ['A1'],
          claimedUntil: addToInstant(farLater, { minutes: 5 }),
        },
        release: [{ showtimeId: showtime.showtimeId, bookingId: first, labels: ['A1'] }],
      }),
    ).toEqual({ claimed: [], missing: ['A1'] });
    await write({
      now: farLater,
      release: [{ showtimeId: showtime.showtimeId, bookingId: first, labels: ['A1'] }],
    });
    expect((await claimsOf()).find((row) => row.seat_label === 'A1')).toEqual({
      seat_label: 'A1',
      booking_id: first,
      claimed_until: null,
    });
    // Hours later the holds of A2 and A3 have ended; the sold A1 is still taken.
    clock.set(farLater);
    const snapshot = await testApp.app.get(SeatAvailabilityService).snapshot(showtime.showtimeId);
    expect(snapshot.seats).toEqual([{ label: 'A1', state: 'booked', heldUntil: null }]);
  });

  it('takes over only the live claims of the bookings it releases, in the same statement', async () => {
    const [first, second, third] = bookings as [number, number, number];
    // Booking 3 re-picks A1 (booking 1's, released here) and A2 (booking 2's, not released).
    expect(
      await write({
        now: NOW,
        claim: {
          showtimeId: showtime.showtimeId,
          bookingId: third,
          labels: ['A2', 'A1'],
          claimedUntil: IN_FIVE,
        },
        release: [{ showtimeId: showtime.showtimeId, bookingId: first, labels: ['A1'] }],
      }),
    ).toEqual({ claimed: ['A1'], missing: ['A2'] });
    const rows = await claimsOf();
    expect(rows.map((row) => [row.seat_label, row.booking_id])).toEqual([
      ['A1', third],
      ['A2', second],
      ['A3', third],
    ]);
  });

  it('frees a released seat at once: its claim ends now and the snapshot drops it', async () => {
    const [first] = bookings as [number, number, number];
    await write({
      now: NOW,
      release: [{ showtimeId: showtime.showtimeId, bookingId: first, labels: ['A1'] }],
    });
    expect((await claimsOf()).find((row) => row.seat_label === 'A1')).toEqual({
      seat_label: 'A1',
      booking_id: first,
      claimed_until: NOW,
    });
    const availability = testApp.app.get(SeatAvailabilityService);
    expect(
      (await availability.snapshot(showtime.showtimeId)).seats.map((seat) => seat.label),
    ).toEqual(['A2', 'A3']);
    expect(await availability.takenCounts([showtime.showtimeId, 999])).toEqual(
      new Map([
        [showtime.showtimeId, 2],
        [999, 0],
      ]),
    );
    expect(await availability.showtimeIdsWithLiveClaims([showtime.showtimeId, 999])).toEqual(
      new Set([showtime.showtimeId]),
    );
    clock.set(IN_FIVE);
    expect(await availability.showtimeIdsWithLiveClaims([showtime.showtimeId])).toEqual(new Set());
  });
});
