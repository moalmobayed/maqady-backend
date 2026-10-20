import { randomUUID } from 'node:crypto';
import { createPublishedMovie } from './catalog';
import { addActiveHall } from './halls';
import { createTheater, everyDay, prepareTheater } from './theaters';
import type {
  SchedulingFixture,
  SchedulingFixtureOptions,
  ShowtimeBody,
  StaffSession,
  TestApp,
} from './types';

/**
 * Showtime fixtures for integration tests (U7), built through the real admin routes so every
 * rule, lock and audit row applies. Later units (U8 discovery, U10 holds, U13 box office) use
 * `createSchedulingFixture()` and `scheduleShowtime()` for showtimes to list and sell.
 *
 * @example
 * const admin = await staffSession(testApp, 'admin');
 * const fixture = await createSchedulingFixture(testApp, admin);
 * const showtime = await scheduleShowtime(testApp, admin, fixture, '2026-10-16', '19:30');
 */

export const SHOWTIMES = '/api/v1/admin/showtimes';
export const SHOWTIME_CHECKS = '/api/v1/admin/showtime-checks';

/**
 * A theater open 12:00–01:00 every day with the default prices (a draft unless published later),
 * an active 12 × 16 hall (192 seats) and a Now showing movie of `runtimeMinutes` (120).
 */
export async function createSchedulingFixture(
  testApp: TestApp,
  admin: StaffSession,
  options: SchedulingFixtureOptions = {},
): Promise<SchedulingFixture> {
  let theaterId = options.theaterId;
  if (theaterId === undefined) {
    theaterId = await createTheater(testApp, admin.authorization);
    await prepareTheater(testApp, admin.authorization, theaterId, [
      ...(options.days ?? everyDay('12:00', '01:00')),
    ]);
  }
  const hallId = await addActiveHall(testApp, admin.authorization, theaterId);
  const runtimeMinutes = options.runtimeMinutes ?? 120;
  const movie = await createPublishedMovie(testApp, admin, {
    status: 'now_showing',
    runtimeMinutes,
  });
  return {
    theaterId,
    hallId,
    movieId: movie.id,
    movieTitle: movie.title as string,
    runtimeMinutes,
  };
}

/**
 * Schedules the fixture's movie in its hall on one cinema date at `startTime` through
 * `POST /admin/showtimes`, expecting it to be created; returns the new showtime.
 */
export async function scheduleShowtime(
  testApp: TestApp,
  admin: StaffSession,
  fixture: Pick<SchedulingFixture, 'movieId' | 'hallId'>,
  cinemaDate: string,
  startTime: string,
  extra: Record<string, unknown> = {},
): Promise<ShowtimeBody> {
  const response = await testApp
    .http()
    .post(SHOWTIMES)
    .set('Authorization', admin.authorization)
    .set('Idempotency-Key', randomUUID())
    .send({
      movieId: fixture.movieId,
      hallId: fixture.hallId,
      dates: [cinemaDate],
      startTime,
      skipUnavailable: false,
      ...extra,
    });
  if (response.status !== 201) {
    throw new Error(`scheduleShowtime: ${response.status} ${JSON.stringify(response.body)}`);
  }
  const [result] = (response.body as { results: { showtime: ShowtimeBody }[] }).results;
  return result!.showtime;
}

/** Cancels a showtime through `PATCH /admin/showtimes/{id}`, expecting it to succeed. */
export async function cancelShowtime(
  testApp: TestApp,
  admin: StaffSession,
  showtimeId: number,
  cancelReason = 'technical_issue',
): Promise<void> {
  const response = await testApp
    .http()
    .patch(`${SHOWTIMES}/${showtimeId}`)
    .set('Authorization', admin.authorization)
    .set('Idempotency-Key', randomUUID())
    .send({ status: 'cancelled', cancelReason });
  if (response.status !== 200) {
    throw new Error(`cancelShowtime: ${response.status} ${JSON.stringify(response.body)}`);
  }
}
