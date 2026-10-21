import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { SQLSTATE } from '../../../../src/common/database/postgres-errors';
import { TestClock } from '../../../support/clock';
import { HALLS } from '../../../support/halls';
import { bookableShowtime, expectHold, holdSeats, SMALL_LAYOUT } from '../../../support/holds';
import { signInStaff, staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { BookableShowtimeFixture, StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(120_000);

const NOW = new Date('2026-10-10T10:00:00+03:00');

/** The same grid with seats B1–B4 painted as gaps. */
const NARROWER = {
  ...SMALL_LAYOUT,
  seatMarks: [
    ...SMALL_LAYOUT.seatMarks,
    ...[1, 2, 3, 4].map((seatNumber) => ({ rowLabel: 'B', seatNumber, kind: 'no_seat' })),
  ],
};

/**
 * The hall lock with real seat claims (PRD "Halls and seat maps" 4; design §7.1, §9): a layout
 * cannot change while an unended showtime of the hall has a live claim, and a layout save racing
 * holds never deadlocks with them.
 */
describe('Holds and the hall lock (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let showtime: BookableShowtimeFixture;
  const clock = new TestClock(NOW);
  const deadlocks: unknown[] = [];
  const onQueryError = (error: { code?: string }) => {
    if (error.code === SQLSTATE.DEADLOCK_DETECTED) deadlocks.push(error);
  };

  const putLayout = (layout: object): Promise<Response> =>
    testApp
      .http()
      .put(`${HALLS}/${showtime.hallId}/layout`)
      .set('Authorization', admin.authorization)
      .send(layout);

  beforeAll(async () => {
    testApp = await createTestApp({ clock });
    admin = await staffSession(testApp, 'admin');
    showtime = await bookableShowtime(testApp, admin);
    testApp.knex.on('query-error', onQueryError);
  });

  beforeEach(async () => {
    clock.set(NOW);
    admin = await signInStaff(testApp, admin.email, admin.password);
    deadlocks.length = 0;
    await testApp.knex.raw(
      'TRUNCATE seat_claims, booking_seats, bookings, hold_refusals, audit_events, idempotency_keys CASCADE',
    );
    expect((await putLayout(SMALL_LAYOUT)).status).toBe(200);
  });

  afterAll(async () => {
    testApp.knex.off('query-error', onQueryError);
    await testApp.close();
  });

  it('refuses a layout save while a hold is live, naming the showtime', async () => {
    await expectHold(testApp, showtime.showtimeId, ['C3']);
    const refused = await putLayout(NARROWER);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({
      code: 'HALL_IN_USE',
      details: {
        showtimes: [
          {
            id: showtime.showtimeId,
            startsAt: '2026-10-11T19:30:00+03:00',
            movieTitle: showtime.movieTitle,
          },
        ],
      },
    });
  });

  it('allows the save once the hold ran out by the clock, with nothing having run', async () => {
    await expectHold(testApp, showtime.showtimeId, ['C3']);
    clock.set(new Date(NOW.getTime() + 5 * 60_000 - 1));
    admin = await signInStaff(testApp, admin.email, admin.password);
    expect((await putLayout(NARROWER)).status).toBe(409);
    clock.set(new Date(NOW.getTime() + 5 * 60_000));
    expect((await putLayout(NARROWER)).status).toBe(200);
  });

  it('allows the save once the hold was released', async () => {
    const hold = await expectHold(testApp, showtime.showtimeId, ['C3']);
    const released = await testApp
      .http()
      .delete(`/api/v1/holds/${hold.reference}`)
      .set('X-Hold-Token', hold.holdCode!);
    expect(released.status).toBe(204);
    expect((await putLayout(NARROWER)).status).toBe(200);
  });

  it('never deadlocks when holds race a layout save, and every hold fits the layout that won', async () => {
    const requests = Array.from({ length: 10 }, (_, index) => [`B${(index % 8) + 1}`]);
    const [save, ...holds] = await Promise.all([
      putLayout(NARROWER),
      ...requests.map((seats) =>
        holdSeats(testApp, showtime.showtimeId, seats, { key: randomUUID() }),
      ),
    ]);
    expect([200, 409]).toContain(save.status);
    if (save.status === 409) expect(save.body.error.code).toBe('HALL_IN_USE');
    for (const hold of holds) {
      expect([201, 400, 409]).toContain(hold.status);
      if (hold.status === 409) expect(hold.body.error.code).toBe('SEAT_TAKEN');
    }
    expect(deadlocks).toEqual([]);

    const layout = await testApp
      .http()
      .get(`${HALLS}/${showtime.hallId}/layout`)
      .set('Authorization', admin.authorization);
    const gaps = new Set(
      (layout.body.seatMarks as { rowLabel: string; seatNumber: number; kind: string }[])
        .filter((mark) => mark.kind === 'no_seat')
        .map((mark) => `${mark.rowLabel}${mark.seatNumber}`),
    );
    holds.forEach((hold, index) => {
      const seat = requests[index]![0]!;
      if (hold.status === 201) expect(gaps.has(seat)).toBe(false);
      if (hold.status === 400) expect(gaps.has(seat)).toBe(true);
    });
    // A refused save means a hold committed first; and no live claim ever sits on a gap.
    if (save.status === 409) expect(holds.some((hold) => hold.status === 201)).toBe(true);
    const claimed = await testApp
      .knex('seat_claims')
      .pluck('seat_label')
      .where({ showtime_id: showtime.showtimeId })
      .andWhere('claimed_until', '>', NOW);
    expect(claimed.filter((label: string) => gaps.has(label))).toEqual([]);
  });
});
