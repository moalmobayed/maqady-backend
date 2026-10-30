import type { Response } from 'supertest';
import { addActiveHall } from './halls';
import { createTheater, prepareTheater, setTheaterStatus } from './theaters';
import type { StaffSession, TestApp } from './types';

/**
 * Search fixtures and calls for integration tests (U18), through the real routes.
 *
 * @example
 * const theaterId = await theaterWithStatus(testApp, admin, 'active', { name: 'Nile Cinema' });
 * const response = await searchPublic(testApp, 'nile');
 */

/** `GET /search?q=`, as a guest unless `authorization` is given. */
export function searchPublic(
  testApp: TestApp,
  q: string,
  authorization?: string,
): Promise<Response> {
  const request = testApp.http().get('/api/v1/search').query({ q });
  return authorization === undefined ? request : request.set('Authorization', authorization);
}

/** `GET /admin/search?q=` with this token. */
export function searchStaff(testApp: TestApp, authorization: string, q: string): Promise<Response> {
  return testApp
    .http()
    .get('/api/v1/admin/search')
    .query({ q })
    .set('Authorization', authorization);
}

/**
 * A theater in `status`: a draft as created, or published (hours, prices and an active hall) and
 * then, for `sales_paused`, paused.
 */
export async function theaterWithStatus(
  testApp: TestApp,
  admin: StaffSession,
  status: 'draft' | 'active' | 'sales_paused',
  overrides: Record<string, unknown> = {},
): Promise<number> {
  const id = await createTheater(testApp, admin.authorization, overrides);
  if (status === 'draft') return id;
  await prepareTheater(testApp, admin.authorization, id);
  await addActiveHall(testApp, admin.authorization, id);
  await setTheaterStatus(testApp, admin.authorization, id, 'active');
  if (status === 'sales_paused') {
    await setTheaterStatus(testApp, admin.authorization, id, 'sales_paused');
  }
  return id;
}

/** The ids of one group of a search response, in order. */
export function groupIds(response: Response, group: string): number[] {
  return (response.body[group].items as { id: number }[]).map((item) => item.id);
}
