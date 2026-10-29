import type { Response } from 'supertest';
import type { TestApp } from './types';

/**
 * Payments screen fixtures for integration tests (U16), through the real admin routes. Later units
 * (the Overview, the payments CSV) read the same figures.
 *
 * @example
 * const page = await listTransactions(testApp, admin.authorization, { status: 'pending' });
 * const summary = await paymentsSummary(testApp, admin.authorization, { dateFrom: '2026-10-10' });
 */

/** `GET /admin/payments` with these query parameters. */
export function listTransactions(
  testApp: TestApp,
  authorization: string,
  query: Record<string, string | number> = {},
): Promise<Response> {
  return testApp
    .http()
    .get('/api/v1/admin/payments')
    .query(query)
    .set('Authorization', authorization);
}

/** `GET /admin/payments/summary` with these query parameters. */
export function paymentsSummary(
  testApp: TestApp,
  authorization: string,
  query: Record<string, string> = {},
): Promise<Response> {
  return testApp
    .http()
    .get('/api/v1/admin/payments/summary')
    .query(query)
    .set('Authorization', authorization);
}
