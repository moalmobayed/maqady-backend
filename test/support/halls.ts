import { randomUUID } from 'node:crypto';
import type { TestApp } from './types';

/**
 * Helpers of the hall integration suites (U5), and of any suite that needs a hall: halls set up
 * through the real admin routes, so every row is written the way the API writes it.
 */

export const HALLS = '/api/v1/admin/halls';

/** `/api/v1/admin/theaters/{id}/halls`. */
export function theaterHallsPath(theaterId: number): string {
  return `/api/v1/admin/theaters/${theaterId}/halls`;
}

/** Adds a draft hall (the standard 12 × 16 layout) and returns its id. */
export async function createHall(
  testApp: TestApp,
  authorization: string,
  theaterId: number,
  name = `Hall ${randomUUID().slice(0, 8)}`,
): Promise<number> {
  const response = await testApp
    .http()
    .post(theaterHallsPath(theaterId))
    .set('Authorization', authorization)
    .set('Idempotency-Key', randomUUID())
    .send({ name });
  if (response.status !== 201) {
    throw new Error(`createHall: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return (response.body as { id: number }).id;
}

/** Changes a hall's status through `PATCH`, expecting it to succeed. */
export async function setHallStatus(
  testApp: TestApp,
  authorization: string,
  hallId: number,
  status: string,
): Promise<void> {
  const response = await testApp
    .http()
    .patch(`${HALLS}/${hallId}`)
    .set('Authorization', authorization)
    .send({ status });
  if (response.status !== 200) {
    throw new Error(`setHallStatus: ${response.status} ${JSON.stringify(response.body)}`);
  }
}

/**
 * Adds an `active` hall to the theater and returns its id: what the theater's `active_hall`
 * publish requirement needs.
 */
export async function addActiveHall(
  testApp: TestApp,
  authorization: string,
  theaterId: number,
): Promise<number> {
  const id = await createHall(testApp, authorization, theaterId);
  await setHallStatus(testApp, authorization, id, 'active');
  return id;
}
