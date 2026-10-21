import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { ShowtimeCancellationService } from '../../../../src/modules/showtimes/showtime-cancellation.service';
import { ShowtimeTicketHolderService } from '../../../../src/modules/showtimes/showtime-ticket-holder.service';
import { createPublishedMovie } from '../../../support/catalog';
import { TestClock } from '../../../support/clock';
import { waitForLockWaiters } from '../../../support/database';
import { createHall, HALLS, setHallStatus } from '../../../support/halls';
import { listHttpRoutes, samplePath } from '../../../support/routes';
import {
  cancelShowtime,
  createSchedulingFixture,
  scheduleShowtime,
  SHOWTIME_CHECKS,
  SHOWTIMES,
} from '../../../support/showtimes';
import { RecordingCancellation } from '../../../support/showtimes/recording-cancellation';
import { ScriptedTicketHolders } from '../../../support/showtimes/scripted-ticket-holders';
import { signInStaff, staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { createTheater, DEFAULT_PRICES, everyDay, THEATERS } from '../../../support/theaters';
import type {
  SchedulingFixture,
  ShowtimeBody,
  StaffSession,
  TestApp,
} from '../../../support/types';

// Real staff sign-ins hash passwords with scrypt.
jest.setTimeout(120_000);

// Saturday. Cairo 2026: summer time starts Friday 24 April at 00:00 (clocks jump to 01:00) and
// ends Thursday 29 October at 24:00 (clocks fall back to 23:00).
const NOW = new Date('2026-10-10T10:00:00+03:00');

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

interface AuditRow {
  action: string;
  entity_id: number;
  actor_staff_user_id: number;
  changed_fields: string[];
  metadata: Record<string, unknown>;
}

interface StoredShowtime {
  id: number;
  movie_id: number;
  theater_id: number;
  hall_id: number;
  starts_at: Date;
  ends_at: Date;
  cleaning_ends_at: Date;
  cinema_date: string;
  price_front: number;
  price_middle: number;
  price_back: number;
  currency: string;
  seat_capacity: number;
  status: string;
  cancel_reason: string | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

describe('Admin showtimes (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let boxOffice: StaffSession;
  const clock = new TestClock(NOW);
  const holders = new ScriptedTicketHolders();
  const cancellation = new RecordingCancellation();

  const write = (method: 'post' | 'patch', path: string, key: string | null = randomUUID()) => {
    const request = testApp.http()[method](path).set('Authorization', admin.authorization);
    return key === null ? request : request.set('Idempotency-Key', key);
  };
  const create = (body: object, key?: string | null) => write('post', SHOWTIMES, key).send(body);
  const check = (body: object, key: string | null = null) =>
    write('post', SHOWTIME_CHECKS, key).send(body);
  const patch = (id: number, body: object) => write('patch', `${SHOWTIMES}/${id}`).send(body);
  const get = (id: number) =>
    testApp.http().get(`${SHOWTIMES}/${id}`).set('Authorization', admin.authorization);
  const timeline = (query: Record<string, string | number>) =>
    testApp.http().get(SHOWTIMES).query(query).set('Authorization', admin.authorization);

  const stored = (id: number): Promise<StoredShowtime> =>
    testApp
      .knex('showtimes')
      .select<StoredShowtime[]>('*')
      .where({ id })
      .first() as Promise<StoredShowtime>;
  const showtimeCount = async (): Promise<number> =>
    Number((await testApp.knex('showtimes').count({ n: 'id' }).first())?.n ?? 0);
  const auditRows = (action?: string): Promise<AuditRow[]> => {
    const query = testApp
      .knex('audit_events')
      .select<AuditRow[]>(
        'action',
        'entity_id',
        'actor_staff_user_id',
        'changed_fields',
        'metadata',
      )
      .where({ entity_type: 'showtime' })
      .orderBy('id');
    if (action !== undefined) query.where({ action });
    return query;
  };
  const batch = (
    fixture: Pick<SchedulingFixture, 'movieId' | 'hallId'>,
    dates: string[],
    startTime: string,
    extra: object = {},
  ) => ({ movieId: fixture.movieId, hallId: fixture.hallId, dates, startTime, ...extra });

  /**
   * Moves the clock. Forward, the admin signs in again so the token is valid at the new time;
   * backward (the April summer-time tests), the token issued "later" stays valid.
   */
  const moveClockTo = async (instant: string): Promise<void> => {
    const forward = new Date(instant).getTime() > clock.now().getTime();
    clock.set(new Date(instant));
    if (forward) admin = await signInStaff(testApp, admin.email, admin.password);
  };

  beforeAll(async () => {
    testApp = await createTestApp({
      clock,
      overrides: [
        { provide: ShowtimeTicketHolderService, useValue: holders },
        { provide: ShowtimeCancellationService, useValue: cancellation },
      ],
    });
    admin = await staffSession(testApp, 'admin');
    boxOffice = await staffSession(testApp, 'box_office');
  });

  beforeEach(async () => {
    clock.set(NOW);
    admin = await signInStaff(testApp, admin.email, admin.password);
    holders.reset();
    cancellation.reset();
    await testApp.knex.raw(
      'TRUNCATE theaters, movies, audit_events, idempotency_keys, messages RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await testApp.close();
  });

  describe('the 20-minute cleaning gap, in the database', () => {
    const rowAt = (base: StoredShowtime, startsAt: Date, overrides: object = {}) => {
      const { id: _id, ...columns } = base;
      const runtime = base.ends_at.getTime() - base.starts_at.getTime();
      return {
        ...columns,
        starts_at: startsAt,
        ends_at: new Date(startsAt.getTime() + runtime),
        cleaning_ends_at: new Date(startsAt.getTime() + runtime + 20 * 60_000),
        ...overrides,
      };
    };
    const minutesAfter = (instant: Date, minutes: number) =>
      new Date(instant.getTime() + minutes * 60_000);

    it('refuses a start 19 minutes after the previous end; 20 minutes, another hall and a cancelled one are fine', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const first = await stored(
        (await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '19:30')).id,
      );
      expect(first.cleaning_ends_at.getTime() - first.ends_at.getTime()).toBe(20 * 60_000);

      const tooClose = testApp
        .knex('showtimes')
        .insert(rowAt(first, minutesAfter(first.ends_at, 19)));
      await expect(tooClose).rejects.toMatchObject({
        code: '23P01',
        constraint: 'ex_showtimes_hall_cleaning_gap',
      });
      await testApp.knex('showtimes').insert(rowAt(first, minutesAfter(first.ends_at, 20)));

      const otherHall = await createSchedulingFixture(testApp, admin, {
        theaterId: fixture.theaterId,
      });
      await testApp
        .knex('showtimes')
        .insert(rowAt(first, first.starts_at, { hall_id: otherHall.hallId }));

      // Cancelled, it leaves the constraint: its own slot can be taken again, up to the 21:50 one.
      await cancelShowtime(testApp, admin, first.id);
      await testApp.knex('showtimes').insert(rowAt(first, first.starts_at));
      await expect(
        testApp.knex('showtimes').insert(rowAt(first, minutesAfter(first.starts_at, 1))),
      ).rejects.toMatchObject({ code: '23P01' });
      expect(
        await testApp
          .knex('showtimes')
          .where({ hall_id: fixture.hallId, status: 'scheduled' })
          .count({ n: 'id' })
          .first(),
      ).toEqual({ n: 2 });
    });

    it('refuses the second of two concurrent overlapping inserts once the first commits', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const first = await stored(
        (await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '12:00')).id,
      );
      const start = new Date('2026-10-17T19:30:00+03:00');
      const one = await testApp.knex.transaction();
      const two = await testApp.knex.transaction();
      try {
        await one('showtimes').insert(rowAt(first, start));
        const second = two('showtimes')
          .insert(rowAt(first, minutesAfter(start, 30)))
          .then(
            () => 'inserted',
            (error: { code?: string }) => error.code,
          );
        await waitForLockWaiters(testApp.knex, 1);
        await one.commit();
        expect(await second).toBe('23P01');
      } finally {
        if (!one.isCompleted()) await one.rollback();
        if (!two.isCompleted()) await two.rollback();
      }
      expect(await showtimeCount()).toBe(2);
    });

    it('creates exactly one of ten concurrent overlapping requests; the others name it', async () => {
      // Ten supertest requests at once each add listeners to the one server.
      testApp.app.getHttpServer().setMaxListeners(20);
      const fixture = await createSchedulingFixture(testApp, admin);
      const starts = Array.from(
        { length: 10 },
        (_, index) =>
          `${19 + Math.floor((30 + index * 10) / 60)}:${String((30 + index * 10) % 60).padStart(2, '0')}`,
      );
      expect(starts).toEqual([
        '19:30',
        '19:40',
        '19:50',
        '20:00',
        '20:10',
        '20:20',
        '20:30',
        '20:40',
        '20:50',
        '21:00',
      ]);
      const responses = await Promise.all(
        starts.map((startTime) =>
          create(batch(fixture, ['2026-10-16'], startTime, { skipUnavailable: false })),
        ),
      );
      const created = responses.filter((response) => response.status === 201);
      expect(created).toHaveLength(1);
      const winner = (created[0]!.body as { results: { showtime: ShowtimeBody }[] }).results[0]!
        .showtime.id;
      const refused = responses.filter((response) => response.status !== 201);
      expect(refused).toHaveLength(9);
      for (const response of refused) {
        expectError(response, 409, 'SHOWTIMES_NOT_CREATED');
        const [result] = response.body.error.details.results as {
          result: string;
          conflicts: { showtimeId: number }[];
        }[];
        expect(result!.result).toBe('conflict');
        expect(result!.conflicts.map((conflict) => conflict.showtimeId)).toEqual([winner]);
      }
      expect(await showtimeCount()).toBe(1);
    });
  });

  describe('opening hours', () => {
    it('refuses a start before opening, an end after closing, a closed weekday and an early-closing special date', async () => {
      // 2026-10-15 is a Thursday: closed.
      const days = everyDay('12:00', '01:00').map((day) =>
        day.weekday === 4 ? { weekday: 4, closed: true } : day,
      );
      const fixture = await createSchedulingFixture(testApp, admin, { days });
      const special = await write('post', `${THEATERS}/${fixture.theaterId}/special-dates`).send({
        cinemaDate: '2026-10-17',
        label: 'Private screening',
        closed: false,
        opens: '12:00',
        closes: '20:00',
      });
      expect(special.status).toBe(201);

      const results = async (dates: string[], startTime: string) => {
        const response = await check(batch(fixture, dates, startTime));
        expect(response.status).toBe(200);
        return (response.body.results as { cinemaDate: string; result: string }[]).map((item) => [
          item.cinemaDate,
          item.result,
        ]);
      };
      expect(await results(['2026-10-16'], '11:30')).toEqual([
        ['2026-10-16', 'outside_opening_hours'],
      ]);
      // 23:01 + 120 minutes ends at 01:01, one minute after closing.
      expect(await results(['2026-10-16'], '23:01')).toEqual([
        ['2026-10-16', 'outside_opening_hours'],
      ]);
      expect(await results(['2026-10-15', '2026-10-16', '2026-10-17'], '19:30')).toEqual([
        ['2026-10-15', 'outside_opening_hours'],
        ['2026-10-16', 'available'],
        ['2026-10-17', 'outside_opening_hours'],
      ]);
      const closed = await check(batch(fixture, ['2026-10-15'], '19:30'));
      expect(closed.body.results[0].window).toBeNull();
      const early = await check(batch(fixture, ['2026-10-17'], '19:30'));
      expect(early.body.results[0].window).toEqual({
        opensAt: '2026-10-17T12:00:00+03:00',
        closesAt: '2026-10-17T20:00:00+03:00',
      });

      const refused = await create(
        batch(fixture, ['2026-10-16'], '23:01', { skipUnavailable: true }),
      );
      expectError(refused, 409, 'SHOWTIMES_NOT_CREATED');
      expect(refused.body.error.details.results).toEqual([
        { cinemaDate: '2026-10-16', result: 'outside_opening_hours', conflicts: [] },
      ]);
      expect(await showtimeCount()).toBe(0);
    });

    it('creates a showtime that ends exactly at closing; its cleaning may run past it', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const showtime = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '23:00');
      expect(showtime).toMatchObject({
        startsAt: '2026-10-16T23:00:00+03:00',
        endsAt: '2026-10-17T01:00:00+03:00',
        cleaningEndsAt: '2026-10-17T01:20:00+03:00',
        cinemaDate: '2026-10-16',
      });
    });
  });

  describe('the cinema day and summer time', () => {
    it('puts a 00:30 start on the previous cinema date and on its timeline', async () => {
      const fixture = await createSchedulingFixture(testApp, admin, {
        days: everyDay('12:00', '04:00'),
      });
      const showtime = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '00:30');
      expect(showtime).toMatchObject({
        cinemaDate: '2026-10-16',
        startTime: '00:30',
        startsAt: '2026-10-17T00:30:00+03:00',
        endsAt: '2026-10-17T02:30:00+03:00',
      });
      expect((await stored(showtime.id)).cinema_date).toBe('2026-10-16');
      const sixteenth = await timeline({ theaterId: fixture.theaterId, date: '2026-10-16' });
      expect((sixteenth.body.items as ShowtimeBody[]).map((item) => item.id)).toEqual([
        showtime.id,
      ]);
      const seventeenth = await timeline({ theaterId: fixture.theaterId, date: '2026-10-17' });
      expect(seventeenth.body.items).toEqual([]);
    });

    it('keeps 06:30 on the morning summer time starts on that date (24 April 2026)', async () => {
      await moveClockTo('2026-04-01T10:00:00+02:00');
      const fixture = await createSchedulingFixture(testApp, admin, {
        days: everyDay('06:00', '04:00'),
      });
      const showtime = await scheduleShowtime(testApp, admin, fixture, '2026-04-24', '06:30');
      expect(showtime).toMatchObject({
        cinemaDate: '2026-04-24',
        startsAt: '2026-04-24T06:30:00+03:00',
      });
    });

    it('refuses 00:30 on the night the clocks skip it, in the dry run, the batch and a move', async () => {
      await moveClockTo('2026-04-01T10:00:00+02:00');
      const fixture = await createSchedulingFixture(testApp, admin, {
        days: everyDay('12:00', '04:00'),
      });
      const dryRun = await check(batch(fixture, ['2026-04-22', '2026-04-23'], '00:30'));
      expect(dryRun.status).toBe(200);
      expect(dryRun.body.results).toEqual([
        expect.objectContaining({
          cinemaDate: '2026-04-22',
          result: 'available',
          startsAt: '2026-04-23T00:30:00+02:00',
        }),
        expect.objectContaining({
          cinemaDate: '2026-04-23',
          result: 'time_does_not_exist',
          startsAt: null,
          endsAt: null,
          cleaningEndsAt: null,
        }),
      ]);
      // Every suggestion for that night exists, so none falls in the skipped hour.
      const suggestions = dryRun.body.results[1].suggestions as { startTime: string }[];
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.map((item) => item.startTime)).not.toContain('00:30');

      const created = await create(
        batch(fixture, ['2026-04-22', '2026-04-23'], '00:30', { skipUnavailable: true }),
      );
      expect(created.status).toBe(201);
      expect(
        (created.body.results as { cinemaDate: string; result: string }[]).map((item) => [
          item.cinemaDate,
          item.result,
        ]),
      ).toEqual([
        ['2026-04-22', 'created'],
        ['2026-04-23', 'time_does_not_exist'],
      ]);

      const id = (created.body.results[0].showtime as ShowtimeBody).id;
      const moved = await patch(id, { cinemaDate: '2026-04-23', startTime: '00:30' });
      expectError(moved, 422, 'TIME_DOES_NOT_EXIST');
      expect(moved.body.error.details).toEqual({
        date: '2026-04-24',
        time: '00:30',
        cinemaDate: '2026-04-23',
      });
    });

    it('takes the first 23:30 on the fall-back night and keeps the real runtime', async () => {
      const fixture = await createSchedulingFixture(testApp, admin, {
        days: everyDay('12:00', '04:00'),
      });
      const showtime = await scheduleShowtime(testApp, admin, fixture, '2026-10-29', '23:30');
      expect(showtime).toMatchObject({
        startsAt: '2026-10-29T23:30:00+03:00',
        // 120 real minutes: the wall clock shows 00:30 because it fell back an hour meanwhile.
        endsAt: '2026-10-30T00:30:00+02:00',
        cinemaDate: '2026-10-29',
        startTime: '23:30',
      });
    });
  });

  describe('batch create', () => {
    /** Five dates: the 18th has a showtime in the way, the 19th closes early. */
    const prepareWeek = async (): Promise<{
      fixture: SchedulingFixture;
      blocker: ShowtimeBody;
    }> => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const blocker = await scheduleShowtime(testApp, admin, fixture, '2026-10-18', '20:00');
      const special = await write('post', `${THEATERS}/${fixture.theaterId}/special-dates`).send({
        cinemaDate: '2026-10-19',
        label: 'Armed Forces Day',
        closed: true,
      });
      expect(special.status).toBe(201);
      return { fixture, blocker };
    };
    const WEEK = ['2026-10-20', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19'];

    it('creates the dates that fit with skipUnavailable, reporting every date in date order', async () => {
      const { fixture, blocker } = await prepareWeek();
      const response = await create(batch(fixture, WEEK, '19:30', { skipUnavailable: true }));
      expect(response.status).toBe(201);
      const body = response.body as {
        results: {
          cinemaDate: string;
          result: string;
          showtime: ShowtimeBody | null;
          conflicts: { showtimeId: number }[];
        }[];
        createdCount: number;
        skippedCount: number;
      };
      expect(body.results.map((item) => [item.cinemaDate, item.result])).toEqual([
        ['2026-10-16', 'created'],
        ['2026-10-17', 'created'],
        ['2026-10-18', 'conflict'],
        ['2026-10-19', 'outside_opening_hours'],
        // After the caught violation on the 18th, the transaction carried on.
        ['2026-10-20', 'created'],
      ]);
      expect({ created: body.createdCount, skipped: body.skippedCount }).toEqual({
        created: 3,
        skipped: 2,
      });
      expect(body.results[2]!.conflicts).toEqual([
        {
          showtimeId: blocker.id,
          movieTitle: fixture.movieTitle,
          startsAt: '2026-10-18T20:00:00+03:00',
          endsAt: '2026-10-18T22:00:00+03:00',
          cleaningEndsAt: '2026-10-18T22:20:00+03:00',
        },
      ]);
      expect(body.results[2]!.showtime).toBeNull();
      const first = body.results[0]!.showtime!;
      expect(first).toMatchObject({
        movie: {
          id: fixture.movieId,
          title: fixture.movieTitle,
          status: 'now_showing',
          runtimeMinutes: 120,
          ageRating: '12+',
        },
        theaterId: fixture.theaterId,
        hall: { id: fixture.hallId },
        startsAt: '2026-10-16T19:30:00+03:00',
        endsAt: '2026-10-16T21:30:00+03:00',
        cleaningEndsAt: '2026-10-16T21:50:00+03:00',
        cinemaDate: '2026-10-16',
        startTime: '19:30',
        status: 'scheduled',
        cancelReason: null,
        cancelledAt: null,
        prices: DEFAULT_PRICES,
        fromPrice: DEFAULT_PRICES.front,
        seatCapacity: 192,
        hasStarted: false,
        hasEnded: false,
        movable: true,
        cancellable: true,
        createdAt: '2026-10-10T10:00:00+03:00',
      });
      // The blocker's own creation came first.
      const created = (await auditRows('showtime.created')).slice(1);
      expect(created.map((row) => row.entity_id)).toEqual(
        body.results.flatMap((item) => (item.showtime ? [item.showtime.id] : [])),
      );
      expect(created[0]).toMatchObject({
        actor_staff_user_id: admin.staffUserId,
        metadata: {
          movieId: fixture.movieId,
          hallId: fixture.hallId,
          theaterId: fixture.theaterId,
          cinemaDate: '2026-10-16',
        },
      });
      expect(await showtimeCount()).toBe(4);
    });

    it('creates nothing without skipUnavailable when one date does not fit, and frees the key', async () => {
      const { fixture, blocker } = await prepareWeek();
      const key = randomUUID();
      const response = await create(batch(fixture, WEEK, '19:30', { skipUnavailable: false }), key);
      expectError(response, 409, 'SHOWTIMES_NOT_CREATED');
      expect(response.body.error.details.results).toEqual([
        { cinemaDate: '2026-10-16', result: 'available', conflicts: [] },
        { cinemaDate: '2026-10-17', result: 'available', conflicts: [] },
        {
          cinemaDate: '2026-10-18',
          result: 'conflict',
          conflicts: [expect.objectContaining({ showtimeId: blocker.id })],
        },
        { cinemaDate: '2026-10-19', result: 'outside_opening_hours', conflicts: [] },
        { cinemaDate: '2026-10-20', result: 'available', conflicts: [] },
      ]);
      expect(await showtimeCount()).toBe(1);
      expect(await auditRows('showtime.created')).toHaveLength(1);
      expect(await testApp.knex('idempotency_keys').where({ key })).toEqual([]);
    });

    it('replays a repeated key, and requires one', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const key = randomUUID();
      const body = batch(fixture, ['2026-10-16'], '19:30', { skipUnavailable: false });
      const first = await create(body, key);
      expect(first.status).toBe(201);
      const again = await create(body, key);
      expect(again.status).toBe(201);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.body).toEqual(first.body);
      expect(await showtimeCount()).toBe(1);
      expectError(await create(body, null), 400, 'IDEMPOTENCY_KEY_REQUIRED');
    });

    it("copies the theater's default prices unless prices are given", async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const prices = {
        front: { amount: 30000, currency: 'EGP' },
        middle: { amount: 25000, currency: 'EGP' },
        back: { amount: 20000, currency: 'EGP' },
      };
      const given = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '13:00', {
        prices,
      });
      expect(given).toMatchObject({ prices, fromPrice: prices.back });
      expect(await stored(given.id)).toMatchObject({
        price_front: 30000,
        price_middle: 25000,
        price_back: 20000,
        currency: 'EGP',
        seat_capacity: 192,
      });
      const copied = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '19:30');
      expect(copied.prices).toEqual(DEFAULT_PRICES);
    });

    it('refuses invalid batches before touching anything', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const days = (count: number, from = 1) =>
        Array.from(
          { length: count },
          (_, index) => `2026-11-${String(from + index).padStart(2, '0')}`,
        );
      const cases: object[] = [
        batch(fixture, [], '19:30', { skipUnavailable: true }),
        batch(fixture, [...days(30), '2026-12-01', '2026-12-02'], '19:30', {
          skipUnavailable: true,
        }),
        batch(fixture, ['2026-11-01', '2026-11-01'], '19:30', { skipUnavailable: true }),
        batch(fixture, ['2026-11-01', '2026-12-02'], '19:30', { skipUnavailable: true }),
        batch(fixture, ['2026-11-31'], '19:30', { skipUnavailable: true }),
        batch(fixture, ['2026-11-01'], '24:00', { skipUnavailable: true }),
        batch(fixture, ['2026-11-01'], '7:30', { skipUnavailable: true }),
        batch(fixture, ['2026-11-01'], '19:30'),
        batch(fixture, ['2026-11-01'], '19:30', {
          skipUnavailable: true,
          prices: { ...DEFAULT_PRICES, back: { amount: 0, currency: 'EGP' } },
        }),
      ];
      for (const body of cases) {
        expectError(await create(body), 400, 'VALIDATION_FAILED');
      }
      // 31 dates over 31 days is the most allowed.
      const most = await check(batch(fixture, days(30).concat('2026-12-01'), '19:30'));
      expect(most.status).toBe(200);
      expect(most.body.results).toHaveLength(31);
      expect(await showtimeCount()).toBe(0);
    });
  });

  describe('the dry run', () => {
    it('writes nothing, with or without a key, and suggests free starts on the grid', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const blocker = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '19:30');
      const counts = async () =>
        Promise.all(
          ['showtimes', 'idempotency_keys', 'audit_events', 'messages'].map(async (table) =>
            Number((await testApp.knex(table).count({ n: '*' }).first())?.n ?? 0),
          ),
        );
      const before = await counts();
      const body = batch(fixture, ['2026-10-16', '2026-10-17'], '18:00');
      const withKey = await check(body, randomUUID());
      const withoutKey = await check(body);
      expect(withKey.status).toBe(200);
      expect(withoutKey.body).toEqual(withKey.body);
      expect(await counts()).toEqual(before);

      expect(withKey.body).toMatchObject({
        movie: { id: fixture.movieId, title: fixture.movieTitle },
        hall: { id: fixture.hallId },
        theaterId: fixture.theaterId,
        startTime: '18:00',
      });
      const [conflict, available] = withKey.body.results as {
        result: string;
        conflicts: { showtimeId: number }[];
        suggestions: { startTime: string; startsAt: string }[];
        window: object;
      }[];
      expect(available).toMatchObject({ result: 'available', conflicts: [], suggestions: [] });
      expect(conflict!.result).toBe('conflict');
      expect(conflict!.conflicts.map((item) => item.showtimeId)).toEqual([blocker.id]);
      // Nearest to 18:00 first: 17:10 is the last start whose cleaning ends by the blocker's 19:30
      // start; the first free one after it, 21:50, is further away.
      expect(conflict!.suggestions.map((item) => item.startTime)).toEqual([
        '17:10',
        '17:05',
        '17:00',
      ]);
      for (const suggestion of conflict!.suggestions) {
        expect(suggestion.startTime).toMatch(/^\d{2}:[0-5][05]$/);
        const recheck = await check(batch(fixture, ['2026-10-16'], suggestion.startTime));
        expect(recheck.body.results[0].result).toBe('available');
      }
    });

    it('marks past starts and checks no prices', async () => {
      const theaterId = await createTheater(testApp, admin.authorization);
      const put = await testApp
        .http()
        .put(`${THEATERS}/${theaterId}/hours`)
        .set('Authorization', admin.authorization)
        .send({ days: everyDay('06:00', '04:00') });
      expect(put.status).toBe(200);
      const fixture = await createSchedulingFixture(testApp, admin, { theaterId });
      const response = await check(
        batch(fixture, ['2026-10-09', '2026-10-10', '2026-10-11'], '09:00'),
      );
      expect(response.status).toBe(200);
      expect((response.body.results as { result: string }[]).map((item) => item.result)).toEqual([
        'in_past',
        'in_past',
        'available',
      ]);
      // Creating needs prices: the theater has none and none were given.
      const refused = await create(
        batch(fixture, ['2026-10-11'], '09:00', { skipUnavailable: true }),
      );
      expectError(refused, 409, 'SHOWTIME_NOT_SCHEDULABLE');
      expect(refused.body.error.details).toEqual({ reasons: ['no_prices'] });
      const priced = await create(
        batch(fixture, ['2026-10-11'], '09:00', { skipUnavailable: true, prices: DEFAULT_PRICES }),
      );
      expect(priced.status).toBe(201);
    });
  });

  describe('what can be scheduled', () => {
    it('refuses a movie that is not Now showing and a hall that is not active', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const comingSoon = await createPublishedMovie(testApp, admin, { status: 'coming_soon' });
      const draftHall = await createHall(testApp, admin.authorization, fixture.theaterId);
      const reasons = async (body: object) => {
        const response = await check(body);
        expectError(response, 409, 'SHOWTIME_NOT_SCHEDULABLE');
        const created = await create({ ...body, skipUnavailable: true });
        expectError(created, 409, 'SHOWTIME_NOT_SCHEDULABLE');
        return response.body.error.details.reasons as string[];
      };
      expect(
        await reasons(
          batch({ movieId: comingSoon.id, hallId: fixture.hallId }, ['2026-10-16'], '19:30'),
        ),
      ).toEqual(['movie_not_now_showing']);
      expect(
        await reasons(
          batch({ movieId: fixture.movieId, hallId: draftHall }, ['2026-10-16'], '19:30'),
        ),
      ).toEqual(['hall_not_active']);
      await setHallStatus(testApp, admin.authorization, draftHall, 'retired');
      expect(
        await reasons(
          batch({ movieId: comingSoon.id, hallId: draftHall }, ['2026-10-16'], '19:30'),
        ),
      ).toEqual(['movie_not_now_showing', 'hall_not_active']);
      const archived = await write('patch', `/api/v1/admin/movies/${fixture.movieId}`).send({
        status: 'archived',
      });
      expect(archived.status).toBe(200);
      expect(await reasons(batch(fixture, ['2026-10-16'], '19:30'))).toEqual([
        'movie_not_now_showing',
      ]);
      expect(await showtimeCount()).toBe(0);
    });

    it('answers NOT_FOUND for an unknown hall or movie', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      for (const [body, entity] of [
        [batch({ movieId: fixture.movieId, hallId: 9999 }, ['2026-10-16'], '19:30'), 'hall'],
        [batch({ movieId: 9999, hallId: fixture.hallId }, ['2026-10-16'], '19:30'), 'movie'],
      ] as const) {
        const dryRun = await check(body);
        expectError(dryRun, 404, 'NOT_FOUND');
        expect(dryRun.body.error.details).toEqual({ entity });
        const created = await create({ ...body, skipUnavailable: true });
        expectError(created, 404, 'NOT_FOUND');
        expect(created.body.error.details).toEqual({ entity });
      }
    });
  });

  describe('moving', () => {
    it('moves to a new time and date, recomputing the end and the cinema date, and records it', async () => {
      const fixture = await createSchedulingFixture(testApp, admin, { runtimeMinutes: 100 });
      const showtime = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '19:30');
      // Moving next to itself is fine: it never conflicts with its own slot.
      const later = await patch(showtime.id, { startTime: '20:00' });
      expect(later.status).toBe(200);
      expect(later.body).toMatchObject({
        id: showtime.id,
        startsAt: '2026-10-16T20:00:00+03:00',
        endsAt: '2026-10-16T21:40:00+03:00',
        cleaningEndsAt: '2026-10-16T22:00:00+03:00',
        cinemaDate: '2026-10-16',
        startTime: '20:00',
      });
      const nextDay = await patch(showtime.id, { cinemaDate: '2026-10-17', startTime: '13:00' });
      expect(nextDay.status).toBe(200);
      expect(await stored(showtime.id)).toMatchObject({
        starts_at: new Date('2026-10-17T13:00:00+03:00'),
        ends_at: new Date('2026-10-17T14:40:00+03:00'),
        cinema_date: '2026-10-17',
        status: 'scheduled',
      });
      const moves = await auditRows('showtime.moved');
      expect(moves).toHaveLength(2);
      expect(moves[1]).toMatchObject({
        entity_id: showtime.id,
        changed_fields: ['startsAt'],
        metadata: {
          previousStartsAt: '2026-10-16T20:00:00+03:00',
          startsAt: '2026-10-17T13:00:00+03:00',
          notifiedCount: 0,
        },
      });
    });

    it("uses the movie's current runtime", async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const showtime = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '19:30');
      const edited = await write('patch', `/api/v1/admin/movies/${fixture.movieId}`).send({
        runtimeMinutes: 150,
      });
      expect(edited.status).toBe(200);
      // A runtime change alone never touches the showtime.
      expect((await get(showtime.id)).body.endsAt).toBe('2026-10-16T21:30:00+03:00');
      const moved = await patch(showtime.id, { startTime: '19:00' });
      expect(moved.body.endsAt).toBe('2026-10-16T21:30:00+03:00');
      expect(moved.body.movie.runtimeMinutes).toBe(150);
    });

    it('refuses a move into another showtime, naming it, and outside the hours', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const first = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '13:00');
      const second = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '19:30');
      const conflict = await patch(second.id, { startTime: '15:10' });
      expectError(conflict, 409, 'SHOWTIME_CONFLICT');
      expect(conflict.body.error.details).toEqual({
        conflicts: [
          {
            showtimeId: first.id,
            movieTitle: fixture.movieTitle,
            startsAt: '2026-10-16T13:00:00+03:00',
            endsAt: '2026-10-16T15:00:00+03:00',
            cleaningEndsAt: '2026-10-16T15:20:00+03:00',
          },
        ],
      });
      expect(await patch(second.id, { startTime: '15:20' })).toHaveProperty('status', 200);

      const outside = await patch(second.id, { startTime: '23:30' });
      expectError(outside, 422, 'OUTSIDE_OPENING_HOURS');
      expect(outside.body.error.details).toEqual({
        window: { opensAt: '2026-10-16T12:00:00+03:00', closesAt: '2026-10-17T01:00:00+03:00' },
      });
      expectError(
        await patch(second.id, { cinemaDate: '2026-10-05', startTime: '19:30' }),
        400,
        'VALIDATION_FAILED',
      );
      expect((await stored(second.id)).starts_at).toEqual(new Date('2026-10-16T15:20:00+03:00'));
    });

    it('refuses moving or re-pricing a started showtime, and a move once the movie is archived', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const showtime = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '19:30');
      const other = await scheduleShowtime(testApp, admin, fixture, '2026-10-17', '19:30');
      const archived = await write('patch', `/api/v1/admin/movies/${fixture.movieId}`).send({
        status: 'archived',
      });
      expect(archived.status).toBe(200);
      const refused = await patch(other.id, { startTime: '20:00' });
      expectError(refused, 409, 'SHOWTIME_NOT_SCHEDULABLE');
      expect(refused.body.error.details).toEqual({ reasons: ['movie_not_now_showing'] });

      await moveClockTo('2026-10-16T19:30:00+03:00');
      for (const body of [{ startTime: '21:00' }, { prices: DEFAULT_PRICES }]) {
        const response = await patch(showtime.id, body);
        expectError(response, 409, 'SHOWTIME_NOT_EDITABLE');
        expect(response.body.error.details).toEqual({ reason: 'started' });
      }
    });

    it('queues an email per ticket holder and an SMS per phone in one insert, and nothing when the move fails', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const showtime = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '19:30');
      holders.holders.set(showtime.id, [
        {
          bookingId: 501,
          bookingReference: 'MQ-7K2P9X',
          customerId: null,
          email: 'layla@example.com',
          phone: '+201001234567',
        },
        {
          bookingId: 502,
          bookingReference: 'MQ-3H8D4M',
          customerId: null,
          email: 'omar@example.com',
          phone: null,
        },
      ]);
      const statements: string[] = [];
      const listener = (query: { sql: string }) => statements.push(query.sql);
      testApp.knex.on('query', listener);
      let moved: Response;
      try {
        moved = await patch(showtime.id, { startTime: '20:15' });
      } finally {
        testApp.knex.off('query', listener);
      }
      expect(moved.status).toBe(200);
      expect(statements.filter((sql) => /^insert into "messages"/i.test(sql))).toHaveLength(1);
      const messages = await testApp
        .knex('messages')
        .select<
          {
            template: string;
            recipient: string;
            subject: string | null;
            body_text: string;
            related_booking_id: number;
          }[]
        >('template', 'recipient', 'subject', 'body_text', 'related_booking_id')
        .orderBy('id');
      expect(messages.map((row) => [row.template, row.recipient, row.related_booking_id])).toEqual([
        ['showtime.moved', 'layla@example.com', 501],
        ['showtime.moved_sms', '+201001234567', 501],
        ['showtime.moved', 'omar@example.com', 502],
      ]);
      expect(messages[0]!.subject).toBe(
        `New time for ${fixture.movieTitle}: Fri 16 Oct 2026, 20:15`,
      );
      expect(messages[0]!.body_text).toContain('was Fri 16 Oct 2026, 19:30');
      expect(messages[1]!.body_text).toContain('MQ-7K2P9X');
      expect(holders.calls).toEqual([showtime.id]);
      expect((await auditRows('showtime.moved'))[0]!.metadata).toMatchObject({ notifiedCount: 3 });

      // A holder whose phone can't be messaged fails the whole move: nothing moves, nothing queues.
      holders.holders.set(showtime.id, [
        {
          bookingId: 503,
          bookingReference: 'MQ-9Q2W5E',
          customerId: null,
          email: 'nour@example.com',
          phone: 'not-a-phone',
        },
      ]);
      await testApp.knex('messages').truncate();
      const failed = await patch(showtime.id, { startTime: '21:00' });
      expect(failed.status).toBe(500);
      expect((await stored(showtime.id)).starts_at).toEqual(new Date('2026-10-16T20:15:00+03:00'));
      expect(await testApp.knex('messages').count({ n: 'id' }).first()).toEqual({ n: 0 });
    });

    it('changes only the prices, records the zones that changed, and answers a no-op with nothing recorded', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const showtime = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '19:30');
      const prices = { ...DEFAULT_PRICES, front: { amount: 12000, currency: 'EGP' } };
      const changed = await patch(showtime.id, { prices });
      expect(changed.status).toBe(200);
      expect(changed.body).toMatchObject({
        prices,
        fromPrice: { amount: 12000, currency: 'EGP' },
        startsAt: showtime.startsAt,
      });
      expect(await auditRows('showtime.prices_changed')).toEqual([
        expect.objectContaining({ entity_id: showtime.id, changed_fields: ['priceFront'] }),
      ]);
      const before = (await auditRows()).length;
      const same = await patch(showtime.id, { startTime: '19:30', prices });
      expect(same.status).toBe(200);
      expect((await auditRows()).length).toBe(before);

      const both = await patch(showtime.id, {
        startTime: '20:00',
        prices: { ...prices, back: { amount: 26000, currency: 'EGP' } },
      });
      expect(both.status).toBe(200);
      expect((await auditRows('showtime.moved')).at(-1)!.changed_fields).toEqual([
        'priceBack',
        'startsAt',
      ]);
    });

    it('refuses malformed changes', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const showtime = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '19:30');
      for (const body of [
        {},
        { cinemaDate: '2026-10-17' },
        { startTime: '25:00' },
        { status: 'cancelled' },
        { cancelReason: 'low_sales' },
        { status: 'cancelled', cancelReason: 'low_sales', startTime: '20:00' },
        { status: 'cancelled', cancelReason: 'low_sales', prices: DEFAULT_PRICES },
        { status: 'scheduled', cancelReason: 'low_sales' },
        { status: 'cancelled', cancelReason: 'bad_weather' },
        { hallId: 2, startTime: '20:00' },
      ]) {
        expectError(await patch(showtime.id, body), 400, 'VALIDATION_FAILED');
      }
      expectError(await patch(999, { startTime: '20:00' }), 404, 'NOT_FOUND');
      expectError(
        await testApp
          .http()
          .patch(`${SHOWTIMES}/${showtime.id}`)
          .set('Authorization', admin.authorization)
          .send({ startTime: '20:00' }),
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
      );
    });
  });

  describe('cancelling', () => {
    it('cancels through the bookings seam, records it, and frees the slot', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const showtime = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '19:30');
      cancellation.outcome = { refundedBookingCount: 2, releasedHoldCount: 1, notifiedCount: 3 };
      const cancelled = await patch(showtime.id, {
        status: 'cancelled',
        cancelReason: 'print_not_delivered',
      });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body).toMatchObject({
        status: 'cancelled',
        cancelReason: 'print_not_delivered',
        cancelledAt: '2026-10-10T10:00:00+03:00',
        movable: false,
        cancellable: false,
      });
      expect(cancellation.calls).toHaveLength(1);
      expect(cancellation.calls[0]).toMatchObject({
        reason: 'print_not_delivered',
        actor: { kind: 'staff', id: admin.staffUserId },
        showtime: { id: showtime.id, status: 'scheduled', hallName: expect.any(String) },
      });
      expect(await auditRows('showtime.cancelled')).toEqual([
        expect.objectContaining({
          entity_id: showtime.id,
          changed_fields: ['cancelReason', 'status'],
          metadata: {
            reason: 'print_not_delivered',
            refundedBookingCount: 2,
            releasedHoldCount: 1,
            notifiedCount: 3,
          },
        }),
      ]);
      const again = await patch(showtime.id, { status: 'cancelled', cancelReason: 'low_sales' });
      expectError(again, 409, 'SHOWTIME_NOT_EDITABLE');
      expect(again.body.error.details).toEqual({ reason: 'cancelled' });
      expectError(await patch(showtime.id, { startTime: '20:00' }), 409, 'SHOWTIME_NOT_EDITABLE');
      expect(cancellation.calls).toHaveLength(1);

      const replacement = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '19:30');
      expect(replacement.id).not.toBe(showtime.id);
    });

    it('cancels a running showtime, but not one that has ended', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const running = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '13:00');
      const ended = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '19:30');
      await moveClockTo('2026-10-16T21:30:00+03:00');
      const refused = await patch(ended.id, {
        status: 'cancelled',
        cancelReason: 'technical_issue',
      });
      expectError(refused, 409, 'SHOWTIME_NOT_EDITABLE');
      expect(refused.body.error.details).toEqual({ reason: 'ended' });
      await moveClockTo('2026-10-16T14:00:00+03:00');
      const cancelled = await patch(running.id, {
        status: 'cancelled',
        cancelReason: 'technical_issue',
      });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body).toMatchObject({ hasStarted: true, hasEnded: false });
    });
  });

  describe('reads', () => {
    it('shows one showtime with its theater; NOT_FOUND for an unknown id', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const showtime = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '19:30');
      const response = await get(showtime.id);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        ...showtime,
        theater: { id: fixture.theaterId, name: expect.any(String), status: 'draft' },
      });
      expectError(await get(9999), 404, 'NOT_FOUND');
      expectError(await get(0), 400, 'VALIDATION_FAILED');
    });

    it('pages a day of 25 showtimes with its window and halls', async () => {
      const fixture = await createSchedulingFixture(testApp, admin, { runtimeMinutes: 10 });
      // Another hall with a cancelled showtime that day, then retired: still on the timeline.
      const retired = await createSchedulingFixture(testApp, admin, {
        theaterId: fixture.theaterId,
      });
      const gone = await scheduleShowtime(testApp, admin, retired, '2026-10-16', '12:00');
      await cancelShowtime(testApp, admin, gone.id);
      await setHallStatus(testApp, admin.authorization, retired.hallId, 'retired');
      // A draft hall without showtimes is not.
      await createHall(testApp, admin.authorization, fixture.theaterId, 'Zz draft hall');

      const ids: number[] = [];
      for (let index = 0; index < 24; index += 1) {
        const minutes = 12 * 60 + index * 30;
        const startTime = `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
        ids.push((await scheduleShowtime(testApp, admin, fixture, '2026-10-16', startTime)).id);
      }
      const all = [gone.id, ...ids];
      const first = await timeline({ theaterId: fixture.theaterId, date: '2026-10-16' });
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({
        theater: { id: fixture.theaterId, status: 'draft' },
        cinemaDate: '2026-10-16',
        window: { opensAt: '2026-10-16T12:00:00+03:00', closesAt: '2026-10-17T01:00:00+03:00' },
        specialDateLabel: null,
        total: 25,
      });
      const halls = first.body.halls as { id: number; status: string; seatCount: number }[];
      expect(halls.map((hall) => [hall.id, hall.status, hall.seatCount]).sort()).toEqual(
        [
          [fixture.hallId, 'active', 192],
          [retired.hallId, 'retired', 192],
        ].sort(),
      );
      const firstIds = (first.body.items as ShowtimeBody[]).map((item) => item.id);
      expect(firstIds).toHaveLength(20);
      const second = await timeline({
        theaterId: fixture.theaterId,
        date: '2026-10-16',
        cursor: first.body.nextCursor as string,
      });
      expect(second.body.nextCursor).toBeNull();
      const secondIds = (second.body.items as ShowtimeBody[]).map((item) => item.id);
      expect([...firstIds, ...secondIds].sort((a, b) => a - b)).toEqual(all.sort((a, b) => a - b));
      // By start: the cancelled 12:00 showtime shares its start with the first scheduled one.
      expect(firstIds.slice(0, 2).sort((a, b) => a - b)).toEqual(
        [gone.id, ids[0]!].sort((a, b) => a - b),
      );

      const filtered = await timeline({
        theaterId: fixture.theaterId,
        date: '2026-10-16',
        status: 'cancelled',
      });
      expect((filtered.body.items as ShowtimeBody[]).map((item) => item.id)).toEqual([gone.id]);
      const byHall = await timeline({
        theaterId: fixture.theaterId,
        date: '2026-10-16',
        hallId: retired.hallId,
      });
      expect(byHall.body.total).toBe(1);
      expectError(await timeline({ theaterId: 9999, date: '2026-10-16' }), 404, 'NOT_FOUND');
      expectError(
        await timeline({ theaterId: fixture.theaterId, date: '2026-02-30' }),
        400,
        'VALIDATION_FAILED',
      );
      expectError(await timeline({ date: '2026-10-16' }), 400, 'VALIDATION_FAILED');
    });

    it("follows the hall's layout for the from price", async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const showtime = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '19:30');
      expect(showtime.fromPrice).toEqual(DEFAULT_PRICES.front);
      const layout = await testApp
        .http()
        .put(`${HALLS}/${fixture.hallId}/layout`)
        .set('Authorization', admin.authorization)
        .send({
          rowCount: 4,
          seatsPerRow: 8,
          rowZones: ['middle', 'middle', 'back', 'back'],
          seatMarks: [],
        });
      expect(layout.status).toBe(200);
      const after = await get(showtime.id);
      expect(after.body).toMatchObject({ fromPrice: DEFAULT_PRICES.middle, seatCapacity: 32 });
    });
  });

  describe('access', () => {
    it('serves the five admin showtime routes to admins only', async () => {
      const routes = listHttpRoutes(testApp).filter((route) =>
        /^\/api\/v1\/admin\/showtime/.test(route.path),
      );
      expect(routes.map((route) => `${route.method} ${route.path}`).sort()).toEqual([
        'GET /api/v1/admin/showtimes',
        'GET /api/v1/admin/showtimes/:id',
        'PATCH /api/v1/admin/showtimes/:id',
        'POST /api/v1/admin/showtime-checks',
        'POST /api/v1/admin/showtimes',
      ]);
      for (const route of routes) {
        expect(route.access).toBe('admin');
        const method = route.method.toLowerCase() as 'get' | 'post' | 'patch';
        const path = samplePath(route.path);
        const forbidden = await testApp
          .http()
          [method](path)
          .set('Authorization', boxOffice.authorization)
          .set('Idempotency-Key', randomUUID())
          .send({});
        expectError(forbidden, 403, 'FORBIDDEN');
        expectError(await testApp.http()[method](path).send({}), 401, 'UNAUTHENTICATED');
      }
    });
  });
});
