import { buildTestConfig } from '../../../support/test-config';
import { createTestApp } from '../../../support/test-app';
import type { TestApp } from '../../../support/types';

jest.setTimeout(60_000);

const RESET_REQUESTS = '/api/v1/admin/auth/password-reset-requests';
const SETUPS = '/api/v1/admin/auth/password-setups';

/**
 * Design §10.6 with the production limits: staff "Forgot password" at 3 per hour per email and 20
 * per hour per address; password setups under the sign-in limit of 20 per minute per address.
 */
describe('Staff forgot-password and set-password rate limits (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({
      config: buildTestConfig(
        {},
        {
          RATE_LIMIT_EMAIL_REQUEST_EMAIL: '3/1h',
          RATE_LIMIT_EMAIL_REQUEST_IP: '20/1h',
          RATE_LIMIT_SIGN_IN_IP: '20/1m',
        },
      ),
    });
  });

  afterAll(async () => {
    await testApp.close();
  });

  const requestReset = (address: string, email: string) =>
    testApp.http().post(RESET_REQUESTS).set('X-Forwarded-For', address).send({ email });

  const setUp = (address: string) =>
    testApp
      .http()
      .post(SETUPS)
      .set('X-Forwarded-For', address)
      .send({ token: 'q3VbI2vT0xSx5n2b7i1d9mJ8kQe4zW6yR0tP5uL3aGc', password: 'Cinema2026' });

  it('answers the 4th request for one email with RATE_LIMITED and Retry-After, from any address', async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect((await requestReset(`203.0.113.${attempt}`, 'target@maqady.example')).status).toBe(
        202,
      );
    }
    const limited = await requestReset('203.0.113.9', 'TARGET@maqady.example');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await requestReset('203.0.113.9', 'other@maqady.example')).status).toBe(202);
  });

  it('answers the 21st request from one address with RATE_LIMITED, whatever the emails', async () => {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      expect((await requestReset('198.51.100.20', `user${attempt}@maqady.example`)).status).toBe(
        202,
      );
    }
    expect((await requestReset('198.51.100.20', 'user21@maqady.example')).status).toBe(429);
    expect((await requestReset('198.51.100.21', 'user21@maqady.example')).status).toBe(202);
  });

  it('answers the 21st password setup from one address with RATE_LIMITED', async () => {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      expect((await setUp('192.0.2.40')).status).toBe(400);
    }
    const limited = await setUp('192.0.2.40');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect((await setUp('192.0.2.41')).status).toBe(400);
  });
});
