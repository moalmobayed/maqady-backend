import { createLogCapture } from '../../../support/log-capture';
import {
  createProbeTable,
  dropProbeTable,
  PROBE_CONSTRAINT,
  ProbeModule,
} from '../../../support/probe.module';
import { createTestApp } from '../../../support/test-app';
import { buildTestConfig } from '../../../support/test-config';
import type { LogCapture, TestApp } from '../../../support/types';

const SECRETS = {
  email: 'mona.secret@example.com',
  token: 'secret-access-token',
  holdToken: 'secret-hold-code',
  cookie: 'secret-cookie',
  body: 'secret-body-value',
  value: 'secret-unique-value',
};

/** Request lines are written when the response finishes; give the event loop a moment. */
async function waitFor<T>(find: () => T | undefined): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const found = find();
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('log line not written');
}

/** The request line: "request completed", or "request failed" for a 5xx. */
function requestLine(capture: LogCapture, correlationId: string) {
  return waitFor(() =>
    capture
      .entries()
      .find(
        (entry) =>
          entry.correlationId === correlationId &&
          (entry.msg === 'request completed' || entry.msg === 'request failed'),
      ),
  );
}

describe('Request logging (integration)', () => {
  let capture: LogCapture;
  let testApp: TestApp;

  beforeAll(async () => {
    capture = createLogCapture();
    testApp = await createTestApp({
      config: buildTestConfig({ logLevel: 'info' }),
      logDestination: capture.stream,
      imports: [ProbeModule],
    });
    await createProbeTable(testApp.knex, testApp.config.database.schema);
  });

  afterAll(async () => {
    await dropProbeTable(testApp.knex, testApp.config.database.schema);
    await testApp.close();
  });

  it('writes one line per request: method, route template, status, duration and correlationId', async () => {
    const response = await testApp
      .http()
      .get(`/api/v1/health?email=${SECRETS.email}`)
      .set('Authorization', `Bearer ${SECRETS.token}`)
      .set('X-Hold-Token', SECRETS.holdToken)
      .set('Cookie', `sid=${SECRETS.cookie}`);
    const correlationId = response.headers['x-request-id'] as string;

    const line = await requestLine(capture, correlationId);
    expect(line).toMatchObject({
      level: 'info',
      correlationId,
      method: 'GET',
      route: '/api/v1/health',
      statusCode: 200,
    });
    expect(typeof line.responseTime).toBe('number');
    expect(line).not.toHaveProperty('url');
    expect(line).not.toHaveProperty('req');
    expect(line).not.toHaveProperty('headers');
    expect(capture.entries().filter((entry) => entry.correlationId === correlationId)).toHaveLength(
      1,
    );
  });

  it('never logs bodies, query strings, tokens or cookies', async () => {
    await testApp
      .http()
      .post('/api/v1/test-probe/echo')
      .set('Authorization', `Bearer ${SECRETS.token}`)
      .send({ name: SECRETS.body, seats: [] });
    await testApp.http().get(`/api/v1/nope?q=${SECRETS.email}`);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const text = capture.text();
    for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret);
  });

  it('logs a failed route as a warning, with no route template when nothing matched', async () => {
    const response = await testApp.http().get('/api/v1/nope');
    const line = await requestLine(capture, response.headers['x-request-id'] as string);
    expect(line).toMatchObject({ level: 'warn', method: 'GET', route: null, statusCode: 404 });
  });

  it.each([
    [
      'malformed JSON',
      () =>
        testApp
          .http()
          .post('/api/v1/test-probe/echo')
          .set('Content-Type', 'application/json')
          .send('{"name":'),
      'POST',
      400,
    ],
    [
      'a body over 1 MB',
      () =>
        testApp
          .http()
          .post('/api/v1/test-probe/echo')
          .set('Content-Type', 'application/json')
          .send(JSON.stringify({ name: 'x'.repeat(1024 * 1024), seats: [] })),
      'POST',
      413,
    ],
    ['an unknown route outside /api/v1', () => testApp.http().get('/nope'), 'GET', 404],
  ])(
    'writes the one request line for %s, which never reaches the logging middleware',
    async (_case, send, method, statusCode) => {
      const response = await send();
      expect(response.status).toBe(statusCode);
      const correlationId = response.headers['x-request-id'] as string;

      expect(await requestLine(capture, correlationId)).toMatchObject({
        level: 'warn',
        correlationId,
        method,
        route: null,
        statusCode,
      });
      expect(
        capture.entries().filter((entry) => entry.correlationId === correlationId),
      ).toHaveLength(1);
    },
  );

  it('logs an unexpected error with its stack and the request correlationId', async () => {
    const response = await testApp.http().get('/api/v1/test-probe/internal-error');
    const correlationId = response.headers['x-request-id'] as string;

    const errorLine = await waitFor(() =>
      capture
        .entries()
        .find(
          (entry) => entry.correlationId === correlationId && entry.level === 'error' && entry.err,
        ),
    );
    expect(errorLine).toMatchObject({
      context: 'GlobalExceptionFilter',
      code: 'INTERNAL',
      err: { type: 'Error', message: 'probe internal failure' },
    });
    expect(String((errorLine.err as { stack: string }).stack)).toContain('probe.module.ts');
    expect(await requestLine(capture, correlationId)).toMatchObject({
      statusCode: 500,
      level: 'error',
    });
  });

  it('logs a Postgres error by SQLSTATE and constraint only, never the row values', async () => {
    await testApp.http().post('/api/v1/test-probe/items').send({ code: SECRETS.value });
    const response = await testApp
      .http()
      .post('/api/v1/test-probe/items')
      .send({ code: SECRETS.value });
    expect(response.status).toBe(409);
    const correlationId = response.headers['x-request-id'] as string;

    const warning = await waitFor(() =>
      capture.entries().find((entry) => entry.correlationId === correlationId && entry.err),
    );
    expect(warning).toMatchObject({
      level: 'warn',
      code: 'CONFLICT',
      err: { type: 'DatabaseError', code: '23505', constraint: PROBE_CONSTRAINT },
    });
    expect(warning.err).not.toHaveProperty('message');
    expect(capture.text()).not.toContain(SECRETS.value);
  });
});
