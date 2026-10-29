import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { customerHold, pay } from './checkout';
import type { PaidOnlineFixture, PaidOnlineOptions, TestApp } from './types';

/**
 * Admin bookings fixtures for integration tests (U14), through the real admin routes, so every
 * rule, lock and audit row applies. Later units (admin customers, the Payments screen, exports)
 * use them for refunds, payouts and edits.
 *
 * @example
 * const paid = await paidOnline(testApp, showtime.showtimeId, ['B2']);
 * const refund = await refundBooking(testApp, admin.authorization, paid.reference);
 */

/** `GET /admin/bookings` with these query parameters. */
export function listAdminBookings(
  testApp: TestApp,
  authorization: string,
  query: Record<string, string | number> = {},
): Promise<Response> {
  return testApp
    .http()
    .get('/api/v1/admin/bookings')
    .query(query)
    .set('Authorization', authorization);
}

/** `POST /admin/bookings/{ref}/refunds` with a new `Idempotency-Key` unless one is given. */
export function refundBooking(
  testApp: TestApp,
  authorization: string,
  reference: string,
  key: string = randomUUID(),
): Promise<Response> {
  return testApp
    .http()
    .post(`/api/v1/admin/bookings/${reference}/refunds`)
    .set('Authorization', authorization)
    .set('Idempotency-Key', key)
    .send();
}

/** `POST /admin/refunds/{id}/payouts` with a new `Idempotency-Key` unless one is given. */
export function payOutRefund(
  testApp: TestApp,
  authorization: string,
  refundId: number,
  key: string = randomUUID(),
): Promise<Response> {
  return testApp
    .http()
    .post(`/api/v1/admin/refunds/${refundId}/payouts`)
    .set('Authorization', authorization)
    .set('Idempotency-Key', key)
    .send();
}

/** `POST /admin/bookings/{ref}/edit-previews` (no key needed). */
export function previewEdit(
  testApp: TestApp,
  authorization: string,
  reference: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return testApp
    .http()
    .post(`/api/v1/admin/bookings/${reference}/edit-previews`)
    .set('Authorization', authorization)
    .send(body);
}

/** `POST /admin/bookings/{ref}/edits` with a new `Idempotency-Key` unless one is given. */
export function editBooking(
  testApp: TestApp,
  authorization: string,
  reference: string,
  body: Record<string, unknown>,
  key: string = randomUUID(),
): Promise<Response> {
  return testApp
    .http()
    .post(`/api/v1/admin/bookings/${reference}/edits`)
    .set('Authorization', authorization)
    .set('Idempotency-Key', key)
    .send(body);
}

/** `PATCH /admin/showtimes/{id}` cancelling the showtime. */
export function cancelShowtime(
  testApp: TestApp,
  authorization: string,
  showtimeId: number,
  key: string = randomUUID(),
): Promise<Response> {
  return testApp
    .http()
    .patch(`/api/v1/admin/showtimes/${showtimeId}`)
    .set('Authorization', authorization)
    .set('Idempotency-Key', key)
    .send({ status: 'cancelled', cancelReason: 'technical_issue' });
}

/** A new customer's booking of `seats`, paid online (Visa unless told otherwise). */
export async function paidOnline(
  testApp: TestApp,
  showtimeId: number,
  seats: readonly string[],
  options: PaidOnlineOptions = {},
): Promise<PaidOnlineFixture> {
  const hold = await customerHold(testApp, showtimeId, seats, options);
  const paid = await pay(testApp, hold.customer.authorization, hold.reference, options.payment);
  if (paid.status !== 201 || paid.body.payment.status !== 'succeeded') {
    throw new Error(`paidOnline: ${paid.status} ${JSON.stringify(paid.body)}`);
  }
  return {
    reference: hold.reference,
    bookingId: hold.bookingId,
    authorization: hold.customer.authorization,
    customerId: hold.customer.customerId,
  };
}
