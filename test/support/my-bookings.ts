import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { pay, VISA } from './checkout';
import { expectHold } from './holds';
import type { PaymentBody, TestApp } from './types';

/**
 * Customer-bookings fixtures for integration tests (U12), through the real routes: a signed-in
 * customer's hold, paid (or not) with a simulated token, and the three U12 reads and writes.
 *
 * @example
 * const reference = await paidBooking(testApp, customer.authorization, showtimeId, ['B2']);
 * const page = await listMyBookings(testApp, customer.authorization, { tab: 'past' });
 */

/** A hold of `seats` for the signed-in customer, then a payment with `body`; returns the reference. */
export async function paidBooking(
  testApp: TestApp,
  authorization: string,
  showtimeId: number,
  seats: readonly string[],
  body: PaymentBody = VISA,
): Promise<string> {
  const hold = await expectHold(testApp, showtimeId, seats, { authorization });
  const paid = await pay(testApp, authorization, hold.reference, body);
  if (paid.status !== 201) {
    throw new Error(`paidBooking: ${paid.status} ${JSON.stringify(paid.body)}`);
  }
  return hold.reference;
}

/** `GET /me/bookings` with these query parameters (and the token, when given). */
export function listMyBookings(
  testApp: TestApp,
  authorization: string | undefined,
  query: Record<string, string | number> = {},
): Promise<Response> {
  let request = testApp.http().get('/api/v1/me/bookings').query(query);
  if (authorization) request = request.set('Authorization', authorization);
  return request;
}

/** `GET /bookings/{ref}/history` with these query parameters (and the token, when given). */
export function bookingHistory(
  testApp: TestApp,
  authorization: string | undefined,
  reference: string,
  query: Record<string, string | number> = {},
): Promise<Response> {
  let request = testApp.http().get(`/api/v1/bookings/${reference}/history`).query(query);
  if (authorization) request = request.set('Authorization', authorization);
  return request;
}

/** `POST /bookings/{ref}/ticket-deliveries` with a new `Idempotency-Key` unless one is given. */
export function emailAgain(
  testApp: TestApp,
  authorization: string | undefined,
  reference: string,
  key: string | null = randomUUID(),
): Promise<Response> {
  let request = testApp.http().post(`/api/v1/bookings/${reference}/ticket-deliveries`);
  if (authorization) request = request.set('Authorization', authorization);
  if (key !== null) request = request.set('Idempotency-Key', key);
  return request.send();
}
