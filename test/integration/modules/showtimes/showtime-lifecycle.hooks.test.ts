import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import type { StaffPrincipal } from '../../../../src/common/auth/types';
import { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { ShowtimeSeatClaimService } from '../../../../src/modules/showtimes/showtime-seat-claim.service';
import { ShowtimesService } from '../../../../src/modules/showtimes/showtimes.service';
import { TestClock } from '../../../support/clock';
import { waitForLockWaiters } from '../../../support/database';
import { HALLS, theaterHallsPath } from '../../../support/halls';
import {
  cancelShowtime,
  createSchedulingFixture,
  scheduleShowtime,
} from '../../../support/showtimes';
import { signInStaff, staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { THEATERS } from '../../../support/theaters';
import type { StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(120_000);

const NOW = new Date('2026-10-10T10:00:00+03:00');

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

/** U10's seat claims, scripted: the showtimes a suite says have a seat held or sold. */
class ScriptedSeatClaims extends ShowtimeSeatClaimService {
  readonly claimed = new Set<number>();
  readonly calls: number[][] = [];

  showtimeIdsWithLiveClaims(showtimeIds: readonly number[]): Promise<ReadonlySet<number>> {
    this.calls.push([...showtimeIds]);
    return Promise.resolve(new Set(showtimeIds.filter((id) => this.claimed.has(id))));
  }
}

describe('Showtime rules of halls, theaters and movies (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  const clock = new TestClock(NOW);
  const seatClaims = new ScriptedSeatClaims();

  const patchHall = (id: number, body: object) =>
    testApp.http().patch(`${HALLS}/${id}`).set('Authorization', admin.authorization).send(body);
  const deleteHall = (id: number) =>
    testApp.http().delete(`${HALLS}/${id}`).set('Authorization', admin.authorization);
  const putLayout = (id: number, body: object) =>
    testApp
      .http()
      .put(`${HALLS}/${id}/layout`)
      .set('Authorization', admin.authorization)
      .send(body);
  const moveClockTo = async (instant: string): Promise<void> => {
    clock.set(new Date(instant));
    admin = await signInStaff(testApp, admin.email, admin.password);
  };
  const LAYOUT = {
    rowCount: 4,
    seatsPerRow: 8,
    rowZones: ['front', 'middle', 'middle', 'back'],
    seatMarks: [],
  };

  beforeAll(async () => {
    testApp = await createTestApp({
      clock,
      overrides: [{ provide: ShowtimeSeatClaimService, useValue: seatClaims }],
    });
    admin = await staffSession(testApp, 'admin');
  });

  beforeEach(async () => {
    clock.set(NOW);
    admin = await signInStaff(testApp, admin.email, admin.password);
    seatClaims.claimed.clear();
    seatClaims.calls.length = 0;
    await testApp.knex.raw(
      'TRUNCATE theaters, movies, audit_events, idempotency_keys RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await testApp.close();
  });

  describe('halls', () => {
    it('retires a hall once its showtimes have ended or been cancelled, never deletes it', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const showtime = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '19:30');
      expectError(
        await patchHall(fixture.hallId, { status: 'retired' }),
        409,
        'HALL_NOT_RETIRABLE',
      );
      // Running counts as not ended.
      await moveClockTo('2026-10-16T21:29:00+03:00');
      expectError(
        await patchHall(fixture.hallId, { status: 'retired' }),
        409,
        'HALL_NOT_RETIRABLE',
      );
      await moveClockTo('2026-10-16T21:30:00+03:00');
      const deleted = await deleteHall(fixture.hallId);
      expectError(deleted, 409, 'HALL_NOT_DELETABLE');
      expect(deleted.body.error.details).toEqual({ reasons: ['has_showtimes'] });
      const retired = await patchHall(fixture.hallId, { status: 'retired' });
      expect(retired.status).toBe(200);
      expect(retired.body).toMatchObject({ status: 'retired', deletable: false });
      expect((await testApp.knex('showtimes').where({ id: showtime.id }).first()).status).toBe(
        'scheduled',
      );
    });

    it('retires a hall whose only upcoming showtime was cancelled', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const showtime = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '19:30');
      await cancelShowtime(testApp, admin, showtime.id);
      expect((await patchHall(fixture.hallId, { status: 'retired' })).status).toBe(200);
    });

    it('refreshes the seat capacity of upcoming showtimes only when the layout is saved', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const started = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '13:00');
      const upcoming = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '19:30');
      const cancelled = await scheduleShowtime(testApp, admin, fixture, '2026-10-17', '19:30');
      await cancelShowtime(testApp, admin, cancelled.id);
      await moveClockTo('2026-10-16T14:00:00+03:00');
      const saved = await putLayout(fixture.hallId, LAYOUT);
      expect(saved.status).toBe(200);
      const capacities = await testApp
        .knex('showtimes')
        .select('id', 'seat_capacity')
        .orderBy('id');
      expect(capacities).toEqual([
        { id: started.id, seat_capacity: 192 },
        { id: upcoming.id, seat_capacity: 32 },
        { id: cancelled.id, seat_capacity: 192 },
      ]);
    });

    it('refuses a layout save while an unended showtime has a live seat claim (HALL_IN_USE)', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const ended = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '13:00');
      const running = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '16:00');
      const later = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '19:30');
      await moveClockTo('2026-10-16T17:00:00+03:00');
      // No live claim: the save goes through, and only unended showtimes were asked about.
      expect((await putLayout(fixture.hallId, LAYOUT)).status).toBe(200);
      expect(seatClaims.calls).toEqual([[running.id, later.id]]);

      seatClaims.claimed.add(ended.id);
      seatClaims.claimed.add(later.id);
      const refused = await putLayout(fixture.hallId, {
        ...LAYOUT,
        rowCount: 5,
        rowZones: ['front', 'front', 'middle', 'middle', 'back'],
      });
      expectError(refused, 409, 'HALL_IN_USE');
      expect(refused.body.error.details).toEqual({
        showtimes: [
          { id: later.id, startsAt: '2026-10-16T19:30:00+03:00', movieTitle: fixture.movieTitle },
        ],
      });
      expect((await testApp.knex('halls').where({ id: fixture.hallId }).first()).row_count).toBe(4);
    });

    it('lists halls with showtimes as not deletable, in one query for the page', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const empty = await createSchedulingFixture(testApp, admin, { theaterId: fixture.theaterId });
      await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '19:30');
      const list = await testApp
        .http()
        .get(theaterHallsPath(fixture.theaterId))
        .set('Authorization', admin.authorization);
      const deletable = new Map(
        (list.body.items as { id: number; deletable: boolean }[]).map((hall) => [
          hall.id,
          hall.deletable,
        ]),
      );
      expect(deletable.get(fixture.hallId)).toBe(false);
      expect(deletable.get(empty.hallId)).toBe(true);
    });
  });

  describe('theaters and movies', () => {
    it('refuses deleting a movie that ever had a showtime', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const showtime = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '19:30');
      await cancelShowtime(testApp, admin, showtime.id);
      const refused = await testApp
        .http()
        .delete(`/api/v1/admin/movies/${fixture.movieId}`)
        .set('Authorization', admin.authorization);
      expectError(refused, 409, 'MOVIE_NOT_DELETABLE');
      expect(refused.body.error.details).toEqual({ reasons: ['has_showtimes'] });
      const other = await createSchedulingFixture(testApp, admin);
      const deleted = await testApp
        .http()
        .delete(`/api/v1/admin/movies/${other.movieId}`)
        .set('Authorization', admin.authorization);
      expect(deleted.status).toBe(204);
    });

    it('refuses deleting a draft theater that has a showtime', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '19:30');
      const refused = await testApp
        .http()
        .delete(`${THEATERS}/${fixture.theaterId}`)
        .set('Authorization', admin.authorization);
      expectError(refused, 409, 'THEATER_NOT_DELETABLE');
      expect(refused.body.error.details).toEqual({ reasons: ['has_showtimes'] });
    });
  });

  describe('lock order', () => {
    const actorOf = (session: StaffSession): StaffPrincipal => ({
      kind: 'staff',
      id: session.staffUserId,
      sessionId: session.sessionId,
      role: 'admin',
    });

    /**
     * Holds a create's transaction open after its insert, runs `contender` meanwhile, and commits
     * once the contender waits on a lock; returns the contender's response.
     */
    const duringCreate = async (
      fixture: { movieId: number; hallId: number },
      contender: () => Promise<Response>,
    ): Promise<Response> => {
      const transactions = testApp.app.get(TransactionRepository);
      const showtimes = testApp.app.get(ShowtimesService);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let inserted!: () => void;
      const created = new Promise<void>((resolve) => (inserted = resolve));
      const transaction = transactions.run(async () => {
        await showtimes.createBatch(actorOf(admin), {
          movieId: fixture.movieId,
          hallId: fixture.hallId,
          dates: ['2026-10-16'],
          startTime: '19:30',
          skipUnavailable: false,
        });
        inserted();
        await gate;
      });
      await created;
      const response = contender();
      await waitForLockWaiters(testApp.knex, 1);
      release();
      await transaction;
      return response;
    };

    it('makes a hall retire wait for a create in progress, then refuses it', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const retire = await duringCreate(fixture, async () =>
        patchHall(fixture.hallId, { status: 'retired' }),
      );
      expectError(retire, 409, 'HALL_NOT_RETIRABLE');
      expect(await testApp.knex('showtimes').where({ hall_id: fixture.hallId })).toHaveLength(1);
    });

    it('makes archiving the movie wait for a create in progress', async () => {
      const fixture = await createSchedulingFixture(testApp, admin);
      const archive = await duringCreate(fixture, async () =>
        testApp
          .http()
          .patch(`/api/v1/admin/movies/${fixture.movieId}`)
          .set('Authorization', admin.authorization)
          .set('Idempotency-Key', randomUUID())
          .send({ status: 'archived' }),
      );
      expect(archive.status).toBe(200);
      // Archived after the showtime was committed: it stays, and no new one can be scheduled.
      expect(await testApp.knex('showtimes').where({ movie_id: fixture.movieId })).toHaveLength(1);
      const refused = await testApp
        .http()
        .post('/api/v1/admin/showtimes')
        .set('Authorization', admin.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({
          movieId: fixture.movieId,
          hallId: fixture.hallId,
          dates: ['2026-10-17'],
          startTime: '19:30',
          skipUnavailable: true,
        });
      expectError(refused, 409, 'SHOWTIME_NOT_SCHEDULABLE');
    });
  });
});
