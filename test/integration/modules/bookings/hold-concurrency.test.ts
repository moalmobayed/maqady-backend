import type { Response } from 'supertest';
import { SQLSTATE } from '../../../../src/common/database/postgres-errors';
import { TestClock } from '../../../support/clock';
import { bookableShowtime, expectHold, holdSeats } from '../../../support/holds';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { BookableShowtimeFixture, TestApp } from '../../../support/types';

jest.setTimeout(120_000);

const NOW = new Date('2026-10-10T10:00:00+03:00');

/**
 * Concurrent holds against real Postgres, nothing mocked (design §6.3, §7.1, §7.2): the
 * `seat_claims` primary key and the claim statement keep one live claim per seat, the losers are
 * refused and recorded, and the lock order never lets two holds deadlock.
 */
describe('Concurrent holds (integration)', () => {
  let testApp: TestApp;
  let showtime: BookableShowtimeFixture;
  let other: BookableShowtimeFixture;
  const clock = new TestClock(NOW);
  const deadlocks: unknown[] = [];
  const onQueryError = (error: { code?: string }) => {
    if (error.code === SQLSTATE.DEADLOCK_DETECTED) deadlocks.push(error);
  };

  beforeAll(async () => {
    testApp = await createTestApp({ clock });
    const admin = await staffSession(testApp, 'admin');
    showtime = await bookableShowtime(testApp, admin);
    other = await bookableShowtime(testApp, admin, { fixture: showtime, startTime: '22:00' });
    testApp.knex.on('query-error', onQueryError);
  });

  beforeEach(async () => {
    deadlocks.length = 0;
    await testApp.knex.raw(
      'TRUNCATE seat_claims, booking_seats, bookings, hold_refusals, audit_events, idempotency_keys CASCADE',
    );
  });

  afterAll(async () => {
    testApp.knex.off('query-error', onQueryError);
    await testApp.close();
  });

  it('leaves each seat with one live claim when 24 guests race for overlapping seats', async () => {
    // Windows of 3 seats in row B (B1–B3 … B6–B8), 4 guests on each, all at once.
    const requests = Array.from({ length: 24 }, (_, index) => {
      const start = (index % 6) + 1;
      return [`B${start}`, `B${start + 1}`, `B${start + 2}`];
    });
    const responses: Response[] = await Promise.all(
      requests.map((seats) => holdSeats(testApp, showtime.showtimeId, seats)),
    );

    expect(new Set(responses.map((response) => response.status))).toEqual(new Set([201, 409]));
    const winners = responses.flatMap((response, index) =>
      response.status === 201 ? [{ body: response.body, seats: requests[index]! }] : [],
    );
    const losers = responses.flatMap((response, index) =>
      response.status === 409 ? [{ body: response.body, seats: requests[index]! }] : [],
    );

    // The winners' seats never overlap, and the claims are exactly their seats.
    const won = winners.flatMap((winner) => winner.seats);
    expect(new Set(won).size).toBe(won.length);
    const claims = await testApp
      .knex('seat_claims as c')
      .join('bookings as b', 'b.id', 'c.booking_id')
      .select<{ seat_label: string; reference: string }[]>('c.seat_label', 'b.reference')
      .where('c.showtime_id', showtime.showtimeId)
      .andWhere('c.claimed_until', '>', NOW);
    expect(claims.map((claim) => claim.seat_label).sort()).toEqual([...won].sort());
    for (const winner of winners) {
      const mine = claims.filter((claim) => claim.reference === winner.body.reference);
      expect(mine.map((claim) => claim.seat_label).sort()).toEqual([...winner.seats].sort());
    }
    const seatRows = await testApp.knex('booking_seats').count<{ n: number }[]>({ n: '*' });
    expect(Number(seatRows[0]!.n)).toBe(won.length);

    // Every loser is told which of its seats someone else holds, and nothing of it remains.
    for (const loser of losers) {
      expect(loser.body.error.code).toBe('SEAT_TAKEN');
      const taken = loser.body.error.details.seats as string[];
      expect(taken.length).toBeGreaterThan(0);
      for (const seat of taken) {
        expect(loser.seats).toContain(seat);
        expect(won).toContain(seat);
      }
    }
    expect(await testApp.knex('bookings').count<{ n: number }[]>({ n: '*' })).toEqual([
      { n: winners.length },
    ]);
    const refusals = await testApp
      .knex('hold_refusals')
      .select<{ showtime_id: number; seat_count: number; refused_at: Date }[]>(
        'showtime_id',
        'seat_count',
        'refused_at',
      );
    expect(refusals).toHaveLength(losers.length);
    expect(
      refusals.every(
        (row) =>
          row.showtime_id === showtime.showtimeId &&
          row.seat_count === 3 &&
          row.refused_at.getTime() === NOW.getTime(),
      ),
    ).toBe(true);
    expect(deadlocks).toEqual([]);
  });

  it('never deadlocks when two guests keep swapping showtimes and each other’s seats', async () => {
    const first = await expectHold(testApp, showtime.showtimeId, ['C1', 'C2']);
    const second = await expectHold(testApp, other.showtimeId, ['C2', 'C1']);
    let codes = [first.holdCode!, second.holdCode!];
    const statuses = new Set<number>();
    for (let round = 0; round < 20; round += 1) {
      const [mine, theirs] =
        round % 2 === 0
          ? [other.showtimeId, showtime.showtimeId]
          : [showtime.showtimeId, other.showtimeId];
      // Each guest releases its hold on one showtime and claims the seats the other guest is
      // releasing on the other showtime, in the opposite direction: the same rows, locked from
      // both ends. Sorted statements in showtime order make them queue instead of deadlocking.
      const [a, b] = await Promise.all([
        holdSeats(testApp, mine, ['D2', 'D1'], { holdCode: codes[0]! }),
        holdSeats(testApp, theirs, ['D1', 'D2'], { holdCode: codes[1]! }),
      ]);
      statuses.add(a.status).add(b.status);
      codes = [
        a.status === 201 ? (a.body.holdCode as string) : codes[0]!,
        b.status === 201 ? (b.body.holdCode as string) : codes[1]!,
      ];
    }
    expect([...statuses].every((status) => status === 201 || status === 409)).toBe(true);
    expect(statuses.has(201)).toBe(true);
    expect(deadlocks).toEqual([]);
    // Each guest ends with exactly one live hold, and every live claim is one of its seats.
    const live = await testApp
      .knex('bookings')
      .select<{ id: number }[]>('id')
      .where('hold_expires_at', '>', NOW);
    expect(live).toHaveLength(2);
    const claims = await testApp
      .knex('seat_claims as c')
      .join('booking_seats as s', function joinSeats() {
        this.on('s.booking_id', 'c.booking_id').andOn('s.seat_label', 'c.seat_label');
      })
      .select<{ booking_id: number }[]>('c.booking_id')
      .where('c.claimed_until', '>', NOW);
    expect(new Set(claims.map((claim) => claim.booking_id))).toEqual(
      new Set(live.map((row) => row.id)),
    );
  });
});
