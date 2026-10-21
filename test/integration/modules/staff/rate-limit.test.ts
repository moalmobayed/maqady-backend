import { buildTestConfig } from '../../../support/test-config';
import { createTestApp } from '../../../support/test-app';
import type { TestApp } from '../../../support/types';

// The project-level `testTimeout` in jest.config.js is not applied (Jest reads it globally), and
// these suites hash real passwords with scrypt, so they set their own.
jest.setTimeout(60_000);

const SIGN_IN = '/api/v1/admin/auth/sessions';

/** Design 10.6 with the production limits: 5 per minute per address and email, 20 per address. */
describe('Staff sign-in rate limits (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({
      config: buildTestConfig(
        {},
        { RATE_LIMIT_SIGN_IN_EMAIL: '5/1m', RATE_LIMIT_SIGN_IN_IP: '20/1m' },
      ),
    });
  });

  afterAll(async () => {
    await testApp.close();
  });

  const signIn = (address: string, email: string) =>
    testApp
      .http()
      .post(SIGN_IN)
      .set('X-Forwarded-For', address)
      .send({ email, password: 'wrong-password-1' });

  it('answers the 6th attempt for one email from one address with RATE_LIMITED and Retry-After', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await signIn('203.0.113.10', 'target@maqady.example')).status).toBe(401);
    }
    const limited = await signIn('203.0.113.10', 'TARGET@maqady.example');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

    // The same email from another address, and another email from the first, still get through.
    expect((await signIn('203.0.113.11', 'target@maqady.example')).status).toBe(401);
    expect((await signIn('203.0.113.10', 'other@maqady.example')).status).toBe(401);
  });

  it('answers the 21st attempt from one address with RATE_LIMITED, whatever the emails', async () => {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      expect((await signIn('198.51.100.7', `user${attempt}@maqady.example`)).status).toBe(401);
    }
    const limited = await signIn('198.51.100.7', 'user21@maqady.example');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect((await signIn('198.51.100.8', 'user21@maqady.example')).status).toBe(401);
  });
});
