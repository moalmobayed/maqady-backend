import { createTestApp } from '../../../support/test-app';
import { buildTestConfig } from '../../../support/test-config';
import { AccessProbeModule } from '../../../support/foundations-probe.module';
import type { TestApp } from '../../../support/types';

describe('Rate limits (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({
      resetData: false,
      imports: [AccessProbeModule],
      config: buildTestConfig({}, { RATE_LIMIT_DEFAULT: '3/1m', RATE_LIMIT_SEARCH: '2/1m' }),
    });
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('answers 429 RATE_LIMITED with Retry-After once a route passes the default limit', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      statuses.push((await testApp.http().get('/api/v1/test-access/unlimited')).status);
    }
    const limited = await testApp.http().get('/api/v1/test-access/unlimited');

    expect(statuses).toEqual([200, 200, 200]);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
  });

  it('counts the default limit per route', async () => {
    expect((await testApp.http().get('/api/v1/test-access/public')).status).toBe(200);
  });

  it('applies a named limit only where declared, sharing one bucket across its routes', async () => {
    const first = await testApp.http().get('/api/v1/test-access/searches');
    const second = await testApp.http().get('/api/v1/test-access/other-searches');
    const third = await testApp.http().get('/api/v1/test-access/searches');

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
    // Routes without @RateLimit('search') are untouched by it.
    expect((await testApp.http().get('/api/v1/test-access/guest')).status).toBe(200);
  });
});
