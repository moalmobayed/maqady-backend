import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { pay } from './checkout';
import { expectHold } from './holds';
import type { CustomerSessionFixture, PaidOnlineFixture, TestApp } from './types';

/**
 * Admin customers fixtures for integration tests (U15), through the real routes, so every rule,
 * lock and audit row applies. Search (U18) and the customers export (U19) can use them.
 *
 * @example
 * const customer = await registerCustomer(testApp);
 * await paidBookingOf(testApp, customer, showtime.showtimeId, ['B2']);
 * const drawer = await getAdminCustomer(testApp, admin.authorization, customer.customerId);
 */

/** `GET /admin/customers` with these query parameters. */
export function listAdminCustomers(
  testApp: TestApp,
  authorization: string,
  query: Record<string, string | number> = {},
): Promise<Response> {
  return testApp
    .http()
    .get('/api/v1/admin/customers')
    .query(query)
    .set('Authorization', authorization);
}

/** `GET /admin/customers/{id}`. */
export function getAdminCustomer(
  testApp: TestApp,
  authorization: string,
  customerId: number,
): Promise<Response> {
  return testApp
    .http()
    .get(`/api/v1/admin/customers/${customerId}`)
    .set('Authorization', authorization);
}

/** `PATCH /admin/customers/{id}`. */
export function updateAdminCustomer(
  testApp: TestApp,
  authorization: string,
  customerId: number,
  body: Record<string, unknown>,
): Promise<Response> {
  return testApp
    .http()
    .patch(`/api/v1/admin/customers/${customerId}`)
    .set('Authorization', authorization)
    .send(body);
}

/** `DELETE /admin/customers/{id}` (anonymise). */
export function anonymiseCustomer(
  testApp: TestApp,
  authorization: string,
  customerId: number,
): Promise<Response> {
  return testApp
    .http()
    .delete(`/api/v1/admin/customers/${customerId}`)
    .set('Authorization', authorization)
    .send();
}

/** `POST /admin/customers/{id}/password-reset-requests` with a new key unless one is given. */
export function requestCustomerReset(
  testApp: TestApp,
  authorization: string,
  customerId: number,
  key: string = randomUUID(),
): Promise<Response> {
  return testApp
    .http()
    .post(`/api/v1/admin/customers/${customerId}/password-reset-requests`)
    .set('Authorization', authorization)
    .set('Idempotency-Key', key)
    .send();
}

/** A booking of `seats` held and paid by card by this existing customer. */
export async function paidBookingOf(
  testApp: TestApp,
  customer: CustomerSessionFixture,
  showtimeId: number,
  seats: readonly string[],
): Promise<PaidOnlineFixture> {
  const hold = await expectHold(testApp, showtimeId, seats, {
    authorization: customer.authorization,
  });
  const paid = await pay(testApp, customer.authorization, hold.reference);
  if (paid.status !== 201 || paid.body.payment.status !== 'succeeded') {
    throw new Error(`paidBookingOf: ${paid.status} ${JSON.stringify(paid.body)}`);
  }
  const row = await testApp
    .knex('bookings')
    .select<{ id: number }[]>('id')
    .where({ reference: hold.reference })
    .first();
  return {
    reference: hold.reference,
    bookingId: row!.id,
    authorization: customer.authorization,
    customerId: customer.customerId,
  };
}
