import { ShowtimeReadService } from '../../../../src/modules/showtimes/showtime-read.service';
import { TestClock } from '../../../support/clock';
import { countQueries } from '../../../support/discovery';
import { HALLS } from '../../../support/halls';
import {
  cancelShowtime,
  createSchedulingFixture,
  scheduleShowtime,
} from '../../../support/showtimes';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { DEFAULT_PRICES } from '../../../support/theaters';
import type { SchedulingFixture, StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(120_000);

const NOW = new Date('2026-10-10T10:00:00+03:00');

describe('ShowtimeReadService (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let reads: ShowtimeReadService;
  const clock = new TestClock(NOW);

  beforeAll(async () => {
    testApp = await createTestApp({ clock });
    reads = testApp.app.get(ShowtimeReadService);
    admin = await staffSession(testApp, 'admin');
  });

  beforeEach(async () => {
    await testApp.knex.raw(
      'TRUNCATE theaters, movies, audit_events, idempotency_keys RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await testApp.close();
  });

  /** Two theaters, two movies (each in its own hall), showtimes on 16–18 Oct. */
  const prepare = async () => {
    const first = await createSchedulingFixture(testApp, admin, { runtimeMinutes: 10 });
    const second = await createSchedulingFixture(testApp, admin, { runtimeMinutes: 10 });
    const ids = {
      firstEarly: (await scheduleShowtime(testApp, admin, first, '2026-10-16', '13:00')).id,
      firstLate: (await scheduleShowtime(testApp, admin, first, '2026-10-16', '20:00')).id,
      firstNextDay: (await scheduleShowtime(testApp, admin, first, '2026-10-17', '13:00')).id,
      secondMidday: (await scheduleShowtime(testApp, admin, second, '2026-10-16', '15:00')).id,
      secondCancelled: (await scheduleShowtime(testApp, admin, second, '2026-10-16', '12:00')).id,
      secondAfterMidnight: (await scheduleShowtime(testApp, admin, second, '2026-10-16', '00:30'))
        .id,
    };
    await cancelShowtime(testApp, admin, ids.secondCancelled);
    return { first, second, ids };
  };

  it('reads one showtime in any status, with its hall, prices and from price', async () => {
    const { first, ids } = await prepare();
    expect(await reads.findById(ids.firstEarly)).toEqual({
      id: ids.firstEarly,
      movieId: first.movieId,
      theaterId: first.theaterId,
      hallId: first.hallId,
      hallName: expect.any(String),
      startsAt: new Date('2026-10-16T13:00:00+03:00'),
      endsAt: new Date('2026-10-16T13:10:00+03:00'),
      cleaningEndsAt: new Date('2026-10-16T13:30:00+03:00'),
      cinemaDate: '2026-10-16',
      status: 'scheduled',
      cancelReason: null,
      cancelledAt: null,
      prices: DEFAULT_PRICES,
      fromPrice: DEFAULT_PRICES.front,
      seatCapacity: 192,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(await reads.findById(ids.secondCancelled)).toMatchObject({
      status: 'cancelled',
      cancelReason: 'technical_issue',
    });
    expect(await reads.findById(9999)).toBeNull();
    const many = await reads.findByIds([ids.firstLate, ids.secondCancelled, 9999]);
    expect([...many.keys()].sort((a, b) => a - b)).toEqual([ids.firstLate, ids.secondCancelled]);
  });

  it('lists scheduled showtimes by movie, by theater and after an instant, by start', async () => {
    const { first, second, ids } = await prepare();
    const byStart = (filter: Parameters<ShowtimeReadService['listScheduled']>[0]) =>
      reads.listScheduled(filter).then((views) => views.map((view) => view.id));

    expect(await byStart({ from: '2026-10-16', to: '2026-10-16' })).toEqual([
      ids.firstEarly,
      ids.secondMidday,
      ids.firstLate,
      ids.secondAfterMidnight,
    ]);
    expect(
      await byStart({ from: '2026-10-16', to: '2026-10-18', movieIds: [first.movieId] }),
    ).toEqual([ids.firstEarly, ids.firstLate, ids.firstNextDay]);
    expect(
      await byStart({ from: '2026-10-16', to: '2026-10-16', theaterIds: [second.theaterId] }),
    ).toEqual([ids.secondMidday, ids.secondAfterMidnight]);
    expect(
      await byStart({
        from: '2026-10-16',
        to: '2026-10-17',
        startsAfter: new Date('2026-10-16T15:00:00+03:00'),
      }),
    ).toEqual([ids.firstLate, ids.secondAfterMidnight, ids.firstNextDay]);
    expect(await byStart({ from: '2026-10-16', to: '2026-10-17', movieIds: [] })).toEqual([]);
    await expect(
      reads.listScheduled({ from: '2026-10-01', to: '2026-11-01' }),
    ).rejects.toMatchObject({
      code: 'INTERNAL',
    });

    expect([...(await reads.movieIdsScheduled({ from: '2026-10-17', to: '2026-10-17' }))]).toEqual([
      first.movieId,
    ]);
  });

  it("gives each movie's next showtime on a cinema date (the home ticker)", async () => {
    const { first, second, ids } = await prepare();
    const next = await reads.nextScheduledPerMovie({
      cinemaDate: '2026-10-16',
      after: new Date('2026-10-16T14:00:00+03:00'),
    });
    expect([...next].map(([movieId, view]) => [movieId, view.id])).toEqual([
      [first.movieId, ids.firstLate],
      [second.movieId, ids.secondMidday],
    ]);
    const late = await reads.nextScheduledPerMovie({
      cinemaDate: '2026-10-16',
      after: new Date('2026-10-16T20:00:00+03:00'),
      theaterIds: [second.theaterId],
    });
    expect([...late.values()].map((view) => view.id)).toEqual([ids.secondAfterMidnight]);
  });

  it('lists the unended showtimes of a hall with their titles', async () => {
    const { first, ids } = await prepare();
    expect(await reads.listUnendedInHall(first.hallId)).toEqual([
      {
        showtimeId: ids.firstEarly,
        startsAt: new Date('2026-10-16T13:00:00+03:00'),
        movieTitle: first.movieTitle,
      },
      {
        showtimeId: ids.firstLate,
        startsAt: new Date('2026-10-16T20:00:00+03:00'),
        movieTitle: first.movieTitle,
      },
      {
        showtimeId: ids.firstNextDay,
        startsAt: new Date('2026-10-17T13:00:00+03:00'),
        movieTitle: first.movieTitle,
      },
    ]);
  });

  it('costs the same number of queries for 1 and 20 showtimes, and follows the layout for the from price', async () => {
    const fixtures: SchedulingFixture[] = [];
    const base = await createSchedulingFixture(testApp, admin, { runtimeMinutes: 10 });
    fixtures.push(base);
    for (let index = 0; index < 3; index += 1) {
      fixtures.push(
        await createSchedulingFixture(testApp, admin, {
          theaterId: base.theaterId,
          runtimeMinutes: 10,
        }),
      );
    }
    const ids: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const fixture = fixtures[index % fixtures.length]!;
      const minutes = 12 * 60 + Math.floor(index / fixtures.length) * 30;
      const startTime = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      ids.push((await scheduleShowtime(testApp, admin, fixture, '2026-10-16', startTime)).id);
    }
    const range = { from: '2026-10-16', to: '2026-10-16' };
    const one = await countQueries(testApp, () => reads.findByIds([ids[0]!]));
    expect(await countQueries(testApp, () => reads.findByIds(ids))).toBe(one);
    const listOne = await countQueries(testApp, () =>
      reads.listScheduled({ ...range, movieIds: [base.movieId] }),
    );
    expect(await countQueries(testApp, () => reads.listScheduled(range))).toBe(listOne);
    const nextOne = await countQueries(testApp, () =>
      reads.nextScheduledPerMovie({
        cinemaDate: '2026-10-16',
        after: NOW,
        movieIds: [base.movieId],
      }),
    );
    expect(
      await countQueries(testApp, () =>
        reads.nextScheduledPerMovie({ cinemaDate: '2026-10-16', after: NOW }),
      ),
    ).toBe(nextOne);
    expect(one).toBe(4);
    expect((await reads.listScheduled(range)).length).toBe(20);

    // A hall without front rows: the from price is the middle price.
    const layout = await testApp
      .http()
      .put(`${HALLS}/${base.hallId}/layout`)
      .set('Authorization', admin.authorization)
      .send({
        rowCount: 4,
        seatsPerRow: 8,
        rowZones: ['middle', 'middle', 'back', 'back'],
        seatMarks: [],
      });
    expect(layout.status).toBe(200);
    expect((await reads.findById(ids[0]!))!.fromPrice).toEqual(DEFAULT_PRICES.middle);
    expect((await reads.findById(ids[1]!))!.fromPrice).toEqual(DEFAULT_PRICES.front);
  });
});
