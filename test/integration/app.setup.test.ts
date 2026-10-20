import { ProbeModule } from '../support/probe.module';
import { createTestApp } from '../support/test-app';
import { TEST_CORS_ORIGIN } from '../support/test-config';
import type { TestApp } from '../support/types';

/** Splits a comma-separated header value into lower-cased names. */
const headerList = (value: string | string[] | undefined): string[] =>
  (Array.isArray(value) ? value.join(',') : (value ?? ''))
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

describe('HTTP settings from configureApp (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ imports: [ProbeModule] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  describe('CORS', () => {
    it('answers a preflight from an allowed origin with the allowed headers and methods', async () => {
      const response = await testApp
        .http()
        .options('/api/v1/health')
        .set('Origin', TEST_CORS_ORIGIN)
        .set('Access-Control-Request-Method', 'PATCH')
        .set(
          'Access-Control-Request-Headers',
          'authorization,content-type,idempotency-key,x-hold-token,x-request-id',
        );
      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe(TEST_CORS_ORIGIN);
      expect(headerList(response.headers['access-control-allow-headers'])).toEqual([
        'authorization',
        'content-type',
        'idempotency-key',
        'x-hold-token',
        'x-request-id',
      ]);
      expect(headerList(response.headers['access-control-allow-methods'])).toEqual([
        'get',
        'head',
        'post',
        'put',
        'patch',
        'delete',
      ]);
      expect(response.headers['access-control-max-age']).toBe('600');
      expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('exposes the headers the frontend reads, Retry-After included', async () => {
      const response = await testApp.http().get('/api/v1/health').set('Origin', TEST_CORS_ORIGIN);
      expect(response.headers['access-control-allow-origin']).toBe(TEST_CORS_ORIGIN);
      expect(headerList(response.headers['access-control-expose-headers'])).toEqual([
        'idempotent-replayed',
        'x-request-id',
        'content-disposition',
        'retry-after',
      ]);
      expect(headerList(response.headers.vary)).toContain('origin');
    });

    it('grants a foreign origin nothing', async () => {
      const response = await testApp
        .http()
        .options('/api/v1/health')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'GET');
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  it("sends helmet's security headers, without upgrade-insecure-requests", async () => {
    const response = await testApp.http().get('/api/v1/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['strict-transport-security']).toContain('max-age=');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  describe('client address behind one trusted proxy hop', () => {
    it("takes the address Render's proxy appended", async () => {
      const response = await testApp
        .http()
        .get('/api/v1/test-probe/client-ip')
        .set('X-Forwarded-For', '198.51.100.23');
      expect(response.body).toEqual({ ip: '198.51.100.23' });
    });

    it('ignores addresses a client put in front to spoof its own', async () => {
      const response = await testApp
        .http()
        .get('/api/v1/test-probe/client-ip')
        .set('X-Forwarded-For', '203.0.113.99, 198.51.100.23');
      expect(response.body).toEqual({ ip: '198.51.100.23' });
    });
  });
});
