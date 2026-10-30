import type { Response } from 'supertest';
import { HALLS } from './halls';
import { SMALL_LAYOUT } from './holds';
import { createSchedulingFixture } from './showtimes';
import { setTheaterStatus } from './theaters';
import type { SchedulingFixture, StaffSession, TestApp } from './types';

/**
 * Overview and bell fixtures for integration tests (U17), through the real admin routes. Later
 * units (the overview CSV) read the same figures.
 *
 * @example
 * const overview = await getOverview(testApp, admin.authorization, { period: 'today' });
 * const bell = await listAlerts(testApp, boxOffice.authorization);
 * await markAlertsRead(testApp, boxOffice.authorization, { keys: [bell.body.items[0].key] });
 */

/** `GET /admin/overview` with these query parameters. */
export function getOverview(
  testApp: TestApp,
  authorization: string,
  query: Record<string, string | number> = {},
): Promise<Response> {
  return testApp
    .http()
    .get('/api/v1/admin/overview')
    .query(query)
    .set('Authorization', authorization);
}

/** `GET /admin/alerts` with these query parameters. */
export function listAlerts(
  testApp: TestApp,
  authorization: string,
  query: Record<string, string | number> = {},
): Promise<Response> {
  return testApp
    .http()
    .get('/api/v1/admin/alerts')
    .query(query)
    .set('Authorization', authorization);
}

/** `POST /admin/alert-reads` with this body (every current alert when it is empty). */
export function markAlertsRead(
  testApp: TestApp,
  authorization: string,
  body: Record<string, unknown> = {},
): Promise<Response> {
  return testApp
    .http()
    .post('/api/v1/admin/alert-reads')
    .set('Authorization', authorization)
    .send(body);
}

/**
 * Like `bookableShowtime()`'s own fixture, with the weekly hours given (`everyDay('06:00',
 * '04:00')` for after-midnight and early shows): a published theater, its active hall with
 * `SMALL_LAYOUT` (31 seats) and a Now showing movie of 120 minutes. Pass it to
 * `bookableShowtime(testApp, admin, { fixture })` to schedule showtimes.
 */
export async function bookableFixture(
  testApp: TestApp,
  admin: StaffSession,
  days: Record<string, unknown>[],
): Promise<SchedulingFixture> {
  const fixture = await createSchedulingFixture(testApp, admin, { days });
  const layout = await testApp
    .http()
    .put(`${HALLS}/${fixture.hallId}/layout`)
    .set('Authorization', admin.authorization)
    .send(SMALL_LAYOUT);
  if (layout.status !== 200) {
    throw new Error(`bookableFixture layout: ${layout.status} ${JSON.stringify(layout.body)}`);
  }
  await setTheaterStatus(testApp, admin.authorization, fixture.theaterId, 'active');
  return fixture;
}
