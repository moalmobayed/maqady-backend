import type { IncomingMessage, ServerResponse } from 'node:http';
import pino from 'pino';
import type { Options } from 'pino-http';
import {
  buildLoggerParams,
  REDACTION_CENSOR,
  requestLogLevel,
  requestLogLine,
  routeTemplateOf,
} from '../../../../src/common/logging/logger.params';
import { postgresError } from '../../../support/errors';
import { createLogCapture } from '../../../support/log-capture';

function httpOptions(): Options {
  const { pinoHttp } = buildLoggerParams({ level: 'info' });
  return pinoHttp as Options;
}

function capturedLogger() {
  const capture = createLogCapture();
  return { capture, logger: pino(httpOptions(), capture.stream) };
}

function request(fields: Record<string, unknown>): IncomingMessage {
  return { headers: {}, ...fields } as unknown as IncomingMessage;
}

function response(statusCode: number): ServerResponse & { headers: Record<string, unknown> } {
  const headers: Record<string, unknown> = {};
  return {
    statusCode,
    headers,
    setHeader: (name: string, value: unknown) => {
      headers[name] = value;
    },
  } as unknown as ServerResponse & { headers: Record<string, unknown> };
}

describe('buildLoggerParams', () => {
  it('logs to the given destination, or stdout when none is given', () => {
    const capture = createLogCapture();
    expect(
      Array.isArray(buildLoggerParams({ level: 'info', destination: capture.stream }).pinoHttp),
    ).toBe(true);
    expect(Array.isArray(buildLoggerParams({ level: 'info' }).pinoHttp)).toBe(false);
  });

  it('names the request id correlationId and binds only that to request loggers', () => {
    const options = httpOptions();
    expect(options.customAttributeKeys).toEqual({ reqId: 'correlationId' });
    expect(options.quietReqLogger).toBe(true);
    expect(options.quietResLogger).toBe(true);
  });

  it('takes the id from a valid X-Request-Id and echoes it in the response header', () => {
    const genReqId = httpOptions().genReqId!;
    const res = response(200);
    const id = genReqId(
      request({ headers: { 'x-request-id': '9C5B94B1-35AD-49BB-B118-8E8FC24ABF80' } }),
      res,
    );
    expect(id).toBe('9c5b94b1-35ad-49bb-b118-8e8fc24abf80');
    expect(res.headers['X-Request-Id']).toBe(id);
  });

  it('replaces an invalid X-Request-Id with a new UUID, also echoed', () => {
    const res = response(200);
    const id = httpOptions().genReqId!(request({ headers: { 'x-request-id': '<script>' } }), res);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['X-Request-Id']).toBe(id);
  });

  it('writes JSON lines with an ISO time and a named level', () => {
    const { capture, logger } = capturedLogger();
    logger.info('hello');
    const [line] = capture.entries();
    expect(line).toMatchObject({ level: 'info', msg: 'hello' });
    expect(String(line?.time)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('redacts authorization, x-hold-token and cookie headers wherever a header map is logged', () => {
    const { capture, logger } = capturedLogger();
    const headers = {
      authorization: 'Bearer secret-token',
      'x-hold-token': 'hold-secret',
      cookie: 'sid=cookie-secret',
      'user-agent': 'jest',
    };
    logger.info({ headers }, 'headers logged by mistake');
    logger.info({ res: { headers: { 'set-cookie': 'sid=cookie-secret' } } }, 'response headers');
    const text = capture.text();
    expect(text).not.toContain('secret-token');
    expect(text).not.toContain('hold-secret');
    expect(text).not.toContain('cookie-secret');
    expect(capture.entries()[0]).toMatchObject({
      headers: {
        authorization: REDACTION_CENSOR,
        'x-hold-token': REDACTION_CENSOR,
        cookie: REDACTION_CENSOR,
      },
    });
  });

  it('reduces a logged request to its method and route: no URL, query, headers or body', () => {
    const { capture, logger } = capturedLogger();
    logger.info(
      {
        req: request({
          method: 'POST',
          url: '/api/v1/search?q=mona@example.com',
          route: { path: '/api/v1/search' },
          headers: { authorization: 'Bearer secret-token' },
          body: { password: 'hunter2' },
        }),
      },
      'request logged by mistake',
    );
    const [line] = capture.entries();
    expect(line?.req).toEqual({ method: 'POST', route: '/api/v1/search' });
    expect(capture.text()).not.toMatch(/mona@example\.com|secret-token|hunter2/);
  });

  it('logs errors through the safe serializer', () => {
    const { capture, logger } = capturedLogger();
    logger.error(
      {
        err: postgresError({
          code: '23505',
          detail: 'Key (email)=(mona@example.com) already exists.',
        }),
      },
      'failed',
    );
    expect(capture.entries()[0]?.err).toMatchObject({ type: 'DatabaseError', code: '23505' });
    expect(capture.text()).not.toContain('mona@example.com');
  });
});

describe('requestLogLine', () => {
  it('records method, route template, status and duration only', () => {
    const line = requestLogLine(
      request({
        method: 'GET',
        url: '/api/v1/bookings/MQ-7K3P9X?x=1',
        route: { path: '/api/v1/bookings/:ref' },
      }),
      response(200),
      12,
    );
    expect(line).toEqual({
      method: 'GET',
      route: '/api/v1/bookings/:ref',
      statusCode: 200,
      responseTime: 12,
    });
  });
});

describe('routeTemplateOf', () => {
  it('joins the router base URL and the route path', () => {
    expect(routeTemplateOf(request({ baseUrl: '/api/v1', route: { path: '/health' } }))).toBe(
      '/api/v1/health',
    );
  });

  it("is null when no route matched, including the logger's own wildcard mount", () => {
    expect(routeTemplateOf(request({}))).toBeNull();
    expect(routeTemplateOf(request({ route: { path: '/api/v1{/*splat}' } }))).toBeNull();
  });
});

describe('requestLogLevel', () => {
  it.each([
    [200, undefined, 'info'],
    [304, undefined, 'info'],
    [404, undefined, 'warn'],
    [429, undefined, 'warn'],
    [500, undefined, 'error'],
    [503, undefined, 'error'],
    [200, new Error('socket hang up'), 'error'],
  ])('logs status %i (error: %p) at %s', (status, error, level) => {
    expect(requestLogLevel(request({}), response(status), error)).toBe(level);
  });
});
