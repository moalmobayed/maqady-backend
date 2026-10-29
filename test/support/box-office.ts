import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import type { TestApp } from './types';

/**
 * Box office fixtures for integration tests (U13), through the real admin routes, so every rule,
 * lock and audit row applies. Admin bookings (U14) uses them for counter sales to refund or edit.
 *
 * @example
 * const hold = await counterHold(testApp, staff.authorization, showtime.showtimeId, ['B2']);
 * const sale = await counterPay(testApp, staff.authorization, hold.body.reference, CASH_WALK_IN);
 */

/** Cash from a walk-in: the simplest counter sale. */
export const CASH_WALK_IN = { method: 'cash', customer: { kind: 'walk_in' } } as const;

/** `POST /admin/counter-holds` with a new `Idempotency-Key` unless one is given. */
export function counterHold(
  testApp: TestApp,
  authorization: string,
  showtimeId: number,
  seats: readonly string[],
  key: string = randomUUID(),
): Promise<Response> {
  return testApp
    .http()
    .post('/api/v1/admin/counter-holds')
    .set('Authorization', authorization)
    .set('Idempotency-Key', key)
    .send({ showtimeId, seats });
}

/** `POST /admin/bookings/{ref}/counter-payments` with a new `Idempotency-Key` unless given. */
export function counterPay(
  testApp: TestApp,
  authorization: string,
  reference: string,
  body: Record<string, unknown> = CASH_WALK_IN,
  key: string = randomUUID(),
): Promise<Response> {
  return testApp
    .http()
    .post(`/api/v1/admin/bookings/${reference}/counter-payments`)
    .set('Authorization', authorization)
    .set('Idempotency-Key', key)
    .send(body);
}

/** A counter hold and its sale, both expected to succeed; returns the sale's `201` response. */
export async function counterSale(
  testApp: TestApp,
  authorization: string,
  showtimeId: number,
  seats: readonly string[],
  body: Record<string, unknown> = CASH_WALK_IN,
): Promise<Response> {
  const hold = await counterHold(testApp, authorization, showtimeId, seats);
  if (hold.status !== 201) {
    throw new Error(`counterSale hold: ${hold.status} ${JSON.stringify(hold.body)}`);
  }
  const sale = await counterPay(testApp, authorization, hold.body.reference as string, body);
  if (sale.status !== 201) {
    throw new Error(`counterSale payment: ${sale.status} ${JSON.stringify(sale.body)}`);
  }
  return sale;
}

/** `POST /admin/scans`. */
export function scanTicket(
  testApp: TestApp,
  authorization: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return testApp.http().post('/api/v1/admin/scans').set('Authorization', authorization).send(body);
}
