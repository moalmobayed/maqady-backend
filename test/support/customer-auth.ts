import { randomUUID } from 'node:crypto';
import { TransactionRepository } from '../../src/common/database/transaction.repository';
import { CustomerAuthService } from '../../src/modules/customers/customer-auth.service';
import { CustomerService } from '../../src/modules/customers/customer.service';
import type { CustomerSession } from '../../src/modules/customers/types';
import { TEST_FRONTEND_BASE_URL } from './test-config';
import type { CustomerFixture, CustomerSessionFixture, TestApp } from './types';

/**
 * Real customers and real tokens for integration tests of customer routes (U9). Everything goes
 * through the real services and the database; nothing is signed by hand. These call the services,
 * not the HTTP routes, so they never meet the registration or sign-in rate limits.
 *
 * Registering queues a verification email, as the real route does; a suite that counts messages
 * or sent emails registers first and clears them, or counts only what it queued itself.
 *
 * @example
 * const customer = await registerCustomer(testApp);
 * await testApp.http().get('/api/v1/me').set('Authorization', customer.authorization);
 */

/** The password `registerCustomer()` sets unless told otherwise; it meets the policy. */
export const DEFAULT_CUSTOMER_PASSWORD = 'Passw0rd-customer';

/** A new active customer, signed in, with a unique email unless one is given. */
export async function registerCustomer(
  testApp: TestApp,
  fixture: CustomerFixture = {},
): Promise<CustomerSessionFixture> {
  const unique = randomUUID().slice(0, 8);
  const email = fixture.email ?? `customer-${unique}@test.maqady.local`;
  const password = fixture.password ?? DEFAULT_CUSTOMER_PASSWORD;
  const session = await testApp.app
    .get(TransactionRepository)
    .run(() =>
      testApp.app
        .get(CustomerAuthService)
        .register({ email, fullName: fixture.fullName ?? `Test customer ${unique}`, password }),
    );
  return fixtureOf(session, email, password);
}

/** Signs an existing customer in through the real service: a new session and its tokens. */
export async function signInCustomer(
  testApp: TestApp,
  email: string,
  password: string,
): Promise<CustomerSessionFixture> {
  const session = await testApp.app.get(CustomerAuthService).signIn({ email, password });
  return fixtureOf(session, email, password);
}

/** Blocks a customer as the system would: every session revoked, sign-in refused. */
export async function blockCustomer(testApp: TestApp, customerId: number): Promise<void> {
  await testApp.app.get(CustomerService).setStatus({ kind: 'system' }, customerId, 'blocked');
}

/**
 * The token of the one-time link to `path` in an email body (`<FRONTEND_BASE_URL><path>?token=…`).
 * Fails the test when the body holds no such link.
 */
export function customerLinkToken(text: string, path: string): string {
  const prefix = `${TEST_FRONTEND_BASE_URL}${path}?token=`;
  const start = text.indexOf(prefix);
  if (start < 0) throw new Error(`No ${path} link in the email`);
  const match = /^[A-Za-z0-9_-]+/.exec(text.slice(start + prefix.length));
  if (!match) throw new Error(`The ${path} link has no token`);
  return match[0];
}

function fixtureOf(
  session: CustomerSession,
  email: string,
  password: string,
): CustomerSessionFixture {
  return {
    customerId: session.tokens.customerId,
    sessionId: session.tokens.sessionId,
    email,
    password,
    accessToken: session.tokens.accessToken,
    refreshToken: session.tokens.refreshToken,
    authorization: `Bearer ${session.tokens.accessToken}`,
  };
}
