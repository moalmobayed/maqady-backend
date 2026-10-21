import { isUuid } from '../../../../src/common/logging/correlation-id';
import { createTestApp } from '../../../support/test-app';
import { buildTestConfig, TEST_SCHEMA } from '../../../support/test-config';
import type { TestApp } from '../../../support/types';

describe('Health endpoints (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('GET /api/v1/health answers 200 {"status":"ok"} and is never cached', async () => {
    const response = await testApp.http().get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('GET /api/v1/health/ready answers 200 {"status":"ok"} when the real database responds', async () => {
    const response = await testApp.http().get('/api/v1/health/ready');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({ status: 'ok' });
  });

  describe('X-Request-Id', () => {
    it("echoes the client's UUID", async () => {
      const id = '6f9619ff-8b86-4011-b42d-00c04fc964ff';
      const response = await testApp.http().get('/api/v1/health').set('X-Request-Id', id);
      expect(response.headers['x-request-id']).toBe(id);
    });

    it('replaces a value that is not a UUID with a new one', async () => {
      const response = await testApp
        .http()
        .get('/api/v1/health')
        .set('X-Request-Id', 'abc<script>');
      const id = response.headers['x-request-id'] as string;
      expect(isUuid(id)).toBe(true);
    });

    it('generates a different UUID for each request that sends none', async () => {
      const first = await testApp.http().get('/api/v1/health');
      const second = await testApp.http().get('/api/v1/health/ready');
      const ids = [first.headers['x-request-id'], second.headers['x-request-id']] as string[];
      expect(ids.every(isUuid)).toBe(true);
      expect(ids[0]).not.toBe(ids[1]);
    });
  });
});

describe('GET /api/v1/health/ready with the database down (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    // Nothing listens on port 1: every connection attempt is refused, like a stopped database.
    const config = buildTestConfig({
      database: {
        url: 'postgres://postgres:postgres@127.0.0.1:1/maqady_test',
        schema: TEST_SCHEMA,
      },
    });
    testApp = await createTestApp({ config, resetData: false });
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('answers 503 SERVICE_UNAVAILABLE in the error shape', async () => {
    const response = await testApp.http().get('/api/v1/health/ready');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The service is temporarily unavailable.',
        details: null,
        correlationId: response.headers['x-request-id'],
      },
    });
  });

  it('still answers liveness, which never touches the database', async () => {
    const response = await testApp.http().get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
