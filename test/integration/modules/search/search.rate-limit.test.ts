import type { Response } from 'supertest';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { buildTestConfig } from '../../../support/test-config';
import type { StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(120_000);

/** Design §10.6 with the production limit: 60 public searches a minute per IP address. */
describe('Search rate limit (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;

  beforeAll(async () => {
    testApp = await createTestApp({
      config: buildTestConfig({}, { RATE_LIMIT_SEARCH: '60/1m' }),
    });
    admin = await staffSession(testApp, 'admin');
  });

  afterAll(async () => {
    await testApp.close();
  });

  const search = (address: string, q = 'nile'): Promise<Response> =>
    testApp.http().get('/api/v1/search').query({ q }).set('X-Forwarded-For', address);

  it('answers the 61st search in a minute from one address with RATE_LIMITED and Retry-After', async () => {
    for (let n = 1; n <= 60; n += 1) {
      expect((await search('203.0.113.40', `nile ${n}`)).status).toBe(200);
    }
    const limited = await search('203.0.113.40');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

    // Another address has its own count; the staff search and other public reads are not counted.
    expect((await search('203.0.113.41')).status).toBe(200);
    const staff = await testApp
      .http()
      .get('/api/v1/admin/search')
      .query({ q: 'nile' })
      .set('X-Forwarded-For', '203.0.113.40')
      .set('Authorization', admin.authorization);
    expect(staff.status).toBe(200);
    const genres = await testApp
      .http()
      .get('/api/v1/genres')
      .set('X-Forwarded-For', '203.0.113.40');
    expect(genres.status).toBe(200);
  });
});
