import { randomUUID } from 'node:crypto';
import type { TestApp } from './types';

/**
 * Helpers of the theater integration suites (U4b): theaters set up through the real admin
 * routes, so every row is written the way the API writes it.
 */

export const THEATERS = '/api/v1/admin/theaters';

/** The body of `POST /admin/theaters`, with a unique name unless one is given. */
export function theaterBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: `Maqady ${randomUUID().slice(0, 8)}`,
    address: '26 July Street',
    district: 'Zamalek',
    city: 'Cairo',
    latitude: 30.0609,
    longitude: 31.2197,
    ...overrides,
  };
}

/** Seven weekly days, each open from `opens` to `closes` (or closed when both are null). */
export function everyDay(opens: string | null, closes: string | null): Record<string, unknown>[] {
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
    opens === null || closes === null
      ? { weekday, closed: true }
      : { weekday, closed: false, opens, closes },
  );
}

export const DEFAULT_PRICES = {
  front: { amount: 15000, currency: 'EGP' },
  middle: { amount: 19000, currency: 'EGP' },
  back: { amount: 23000, currency: 'EGP' },
};

/** Creates a draft theater and returns its id. */
export async function createTheater(
  testApp: TestApp,
  authorization: string,
  overrides: Record<string, unknown> = {},
): Promise<number> {
  const response = await testApp
    .http()
    .post(THEATERS)
    .set('Authorization', authorization)
    .set('Idempotency-Key', randomUUID())
    .send(theaterBody(overrides));
  if (response.status !== 201) {
    throw new Error(`createTheater: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return (response.body as { id: number }).id;
}

/** Sets the weekly hours (every day `opens`–`closes` by default 12:00–01:00) and the prices. */
export async function prepareTheater(
  testApp: TestApp,
  authorization: string,
  id: number,
  days: Record<string, unknown>[] = everyDay('12:00', '01:00'),
): Promise<void> {
  for (const [path, body] of [
    ['hours', { days }],
    ['prices', DEFAULT_PRICES],
  ] as const) {
    const response = await testApp
      .http()
      .put(`${THEATERS}/${id}/${path}`)
      .set('Authorization', authorization)
      .send(body);
    if (response.status !== 200) {
      throw new Error(
        `prepareTheater ${path}: ${response.status} ${JSON.stringify(response.body)}`,
      );
    }
  }
}

/** Changes a theater's status through `PATCH`, expecting it to succeed. */
export async function setTheaterStatus(
  testApp: TestApp,
  authorization: string,
  id: number,
  status: string,
): Promise<void> {
  const response = await testApp
    .http()
    .patch(`${THEATERS}/${id}`)
    .set('Authorization', authorization)
    .send({ status });
  if (response.status !== 200) {
    throw new Error(`setTheaterStatus: ${response.status} ${JSON.stringify(response.body)}`);
  }
}
