import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { TransactionRepository } from '../../src/common/database/transaction.repository';
import { CustomerAuthService } from '../../src/modules/customers/customer-auth.service';
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

/** A customer "Forgot password" that has issued its link and queued its email, not yet committed. */
export interface ForgotPasswordInFlight {
  /** Lets the transaction commit. */
  readonly release: () => void;
  /** Settles once it committed (or rolled back). */
  readonly committed: Promise<void>;
}

/**
 * Runs the customer "Forgot password" for `email` in a transaction of its own and holds it open,
 * uncommitted, once the link is issued and its email queued, so a race test can run an admin
 * change of the same customer beside it, then `release()` it.
 */
export async function forgotPasswordInFlight(
  testApp: TestApp,
  email: string,
): Promise<ForgotPasswordInFlight> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let issued!: () => void;
  const linkIssued = new Promise<void>((resolve) => (issued = resolve));
  const committed = testApp.app.get(TransactionRepository).run(async () => {
    await testApp.app.get(CustomerAuthService).requestPasswordReset(email);
    issued();
    await gate;
  });
  await Promise.race([linkIssued, committed]);
  return { release, committed };
}

/**
 * Resolves once `pending` has settled or at least one connection to this database waits on a
 * lock, whichever comes first: the race test then releases the transaction it holds open.
 */
export async function settledOrWaitingOnLock(
  testApp: TestApp,
  pending: Promise<unknown>,
): Promise<void> {
  let settled = false;
  void pending.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let attempt = 0; attempt < 250 && !settled; attempt += 1) {
    const { rows } = await testApp.knex.raw<{ rows: { waiting: number }[] }>(
      `SELECT count(*)::int AS waiting FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if ((rows[0]?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
