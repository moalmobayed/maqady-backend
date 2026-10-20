import type { ArgumentsHost } from '@nestjs/common';
import { HttpException, NotFoundException } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import { AppError } from '../../../../src/common/errors/app-error';
import { GlobalExceptionFilter } from '../../../../src/common/errors/global-exception.filter';
import { isUuid } from '../../../../src/common/logging/correlation-id';
import { serializeError } from '../../../../src/common/logging/error-serializer';
import { bodyParserError, postgresError, socketError } from '../../../support/errors';

const REQUEST_ID = '2f1b9a4e-5c3d-4e7f-8a9b-0c1d2e3f4a5b';

interface FakeRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  id?: unknown;
  log?: unknown;
}

function fakeRequest(overrides: Partial<FakeRequest> = {}): FakeRequest {
  // A request the logging middleware saw: it carries an id and a bound logger.
  return {
    method: 'GET',
    path: '/api/v1/things',
    headers: {},
    id: REQUEST_ID,
    log: {},
    ...overrides,
  };
}

interface FakeResponse {
  headersSent: boolean;
  statusCode: number;
  body: unknown;
  destroyed: boolean;
  setHeader: jest.Mock<FakeResponse, [string, unknown]>;
  getHeaders: () => Record<string, unknown>;
  header: (name: string) => unknown;
  status: jest.Mock<FakeResponse, [number]>;
  json: jest.Mock<FakeResponse, [unknown]>;
  destroy: jest.Mock<void, []>;
}

function fakeResponse(preset: Record<string, string> = {}): FakeResponse {
  const headers: Record<string, unknown> = { ...preset };
  const response: FakeResponse = {
    headersSent: false,
    statusCode: 200,
    body: undefined,
    destroyed: false,
    setHeader: jest.fn((name: string, value: unknown) => {
      headers[name.toLowerCase()] = value;
      return response;
    }),
    getHeaders: () => ({ ...headers }),
    header: (name: string) => headers[name.toLowerCase()],
    status: jest.fn((code: number) => {
      response.statusCode = code;
      return response;
    }),
    json: jest.fn((body: unknown) => {
      response.body = body;
      return response;
    }),
    destroy: jest.fn(() => {
      response.destroyed = true;
    }),
  };
  return response;
}

function httpHost(request: FakeRequest, response: FakeResponse): ArgumentsHost {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
      getNext: () => undefined,
    }),
  } as unknown as ArgumentsHost;
}

interface FakeLogger {
  setContext: jest.Mock<void, [string]>;
  error: jest.Mock<void, unknown[]>;
  warn: jest.Mock<void, unknown[]>;
}

function fakeLogger(): FakeLogger {
  return { setContext: jest.fn(), error: jest.fn(), warn: jest.fn() };
}

function run(
  exception: unknown,
  request = fakeRequest(),
  response = fakeResponse(),
): { logger: FakeLogger; request: FakeRequest; response: FakeResponse } {
  const logger = fakeLogger();
  const filter = new GlobalExceptionFilter(logger as unknown as PinoLogger);
  filter.catch(exception, httpHost(request, response));
  return { logger, request, response };
}

describe('GlobalExceptionFilter', () => {
  it('answers with the ErrorResponse shape, the status and an X-Request-Id equal to correlationId', () => {
    const { response } = run(new AppError('NOT_FOUND', 'Booking not found.'));
    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Booking not found.',
        details: null,
        correlationId: REQUEST_ID,
      },
    });
    expect(response.header('X-Request-Id')).toBe(REQUEST_ID);
  });

  it('keeps AppError details', () => {
    const { response } = run(new AppError('VALIDATION_FAILED', undefined, { fields: [] }));
    expect(response.body).toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: { fields: [] } },
    });
  });

  describe('correlation id when the logging middleware never ran (an unreadable body)', () => {
    it("uses the client's X-Request-Id when it is a UUID", () => {
      const request = fakeRequest({
        id: undefined,
        log: undefined,
        headers: { 'x-request-id': REQUEST_ID.toUpperCase() },
      });
      const { response } = run(
        bodyParserError('entity.parse.failed', 400, 'Unexpected token'),
        request,
      );
      expect(response.header('X-Request-Id')).toBe(REQUEST_ID);
      expect(response.body).toMatchObject({ error: { correlationId: REQUEST_ID } });
    });

    it('generates one when the header is missing or not a UUID, and stores it on the request', () => {
      const request = fakeRequest({
        id: undefined,
        log: undefined,
        headers: { 'x-request-id': 'abc; DROP' },
      });
      const { response } = run(bodyParserError('entity.too.large', 413, 'too large'), request);
      const id = response.header('X-Request-Id') as string;
      expect(isUuid(id)).toBe(true);
      expect(id).not.toBe('abc; DROP');
      expect(request.id).toBe(id);
      expect(response.statusCode).toBe(413);
      expect(response.body).toMatchObject({
        error: { code: 'PAYLOAD_TOO_LARGE', correlationId: id },
      });
    });
  });

  describe('RATE_LIMITED', () => {
    it('always sends Retry-After, here from the named throttler header', () => {
      const response = fakeResponse({ 'retry-after-short': '7' });
      run(new HttpException('ThrottlerException: Too Many Requests', 429), fakeRequest(), response);
      expect(response.statusCode).toBe(429);
      expect(response.header('Retry-After')).toBe('7');
      expect(response.body).toMatchObject({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Try again shortly.',
          details: null,
        },
      });
    });

    it('defaults Retry-After when nothing else gives a time', () => {
      const { response } = run(new AppError('RATE_LIMITED'));
      expect(response.header('Retry-After')).toBe('60');
    });

    it('sends no Retry-After for other codes', () => {
      const { response } = run(new AppError('NOT_FOUND'));
      expect(response.header('Retry-After')).toBeUndefined();
    });
  });

  describe('logging', () => {
    it('does not log client errors; the request line already records them', () => {
      const { logger } = run(new NotFoundException('Cannot GET /x'));
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('logs an unexpected error with its stack, but answers with a generic message', () => {
      const exception = new TypeError('cannot read id of undefined');
      const { logger, response } = run(exception);
      expect(response.statusCode).toBe(500);
      expect(response.body).toMatchObject({
        error: { code: 'INTERNAL', message: 'Something went wrong on our side.', details: null },
      });
      expect(JSON.stringify(response.body)).not.toContain('cannot read id');

      expect(logger.error).toHaveBeenCalledTimes(1);
      const [fields, message, code] = logger.error.mock.calls[0] as [
        Record<string, unknown>,
        string,
        string,
      ];
      expect(message).toBe('Request failed: %s');
      expect(code).toBe('INTERNAL');
      // Handed over as `err`, the key whose serializer keeps the stack and strips unsafe parts.
      expect(fields).toEqual({ code: 'INTERNAL', err: exception });
      expect(serializeError(fields.err).stack).toContain('global-exception.filter.test.ts');
      // The request-bound logger already carries the correlation id.
      expect(fields).not.toHaveProperty('correlationId');
    });

    it('logs a database error under err, which serializes to its SQLSTATE and constraint only', () => {
      const error = postgresError({
        code: '42703',
        message: 'column "mona@example.com" does not exist',
        detail: 'Key (email)=(mona@example.com)',
      });
      const { logger } = run(error);
      const [fields] = logger.error.mock.calls[0] as [Record<string, unknown>];
      expect(fields.err).toBe(error);
      const logged = JSON.stringify(serializeError(fields.err));
      expect(logged).toContain('"code":"42703"');
      expect(logged).toContain('DatabaseError');
      expect(logged).not.toContain('mona@example.com');
    });

    it('logs a database outage as a warning and answers SERVICE_UNAVAILABLE', () => {
      const { logger, response } = run(socketError('ECONNREFUSED'));
      expect(response.statusCode).toBe(503);
      expect(response.body).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'SERVICE_UNAVAILABLE',
          err: expect.objectContaining({ code: 'ECONNREFUSED' }),
        }),
        'Request failed: %s',
        'SERVICE_UNAVAILABLE',
      );
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('adds the correlation id itself when the request has no bound logger', () => {
      const request = fakeRequest({
        id: undefined,
        log: undefined,
        headers: { 'x-request-id': REQUEST_ID },
      });
      const { logger } = run(new Error('boom'), request);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: REQUEST_ID }),
        'Request failed: %s',
        'INTERNAL',
      );
    });
  });

  it('aborts a response whose headers were already sent instead of writing a second one', () => {
    const response = fakeResponse();
    response.headersSent = true;
    run(new Error('stream failed'), fakeRequest(), response);
    expect(response.destroy).toHaveBeenCalledTimes(1);
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });

  it('only logs errors from non-HTTP contexts, which handle their own replies', () => {
    const logger = fakeLogger();
    const filter = new GlobalExceptionFilter(logger as unknown as PinoLogger);
    const switchToHttp = jest.fn();
    filter.catch(new Error('ws failure'), {
      getType: () => 'ws',
      switchToHttp,
    } as unknown as ArgumentsHost);
    expect(switchToHttp).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.objectContaining({ message: 'ws failure' }) }),
      'Unhandled non-HTTP error',
    );
  });

  it('sets its logging context to the filter name', () => {
    const logger = fakeLogger();
    new GlobalExceptionFilter(logger as unknown as PinoLogger);
    expect(logger.setContext).toHaveBeenCalledWith('GlobalExceptionFilter');
  });
});
