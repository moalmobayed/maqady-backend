import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  ImATeapotException,
  InternalServerErrorException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { KnexTimeoutError } from 'knex';
import { AppError } from '../../../../src/common/errors/app-error';
import {
  DEFAULT_RETRY_AFTER_SECONDS,
  resolveException,
  resolveRetryAfterSeconds,
} from '../../../../src/common/errors/error-mapping';
import { ERROR_CATALOGUE } from '../../../../src/common/errors/error-catalogue';
import { bodyParserError, postgresError, socketError } from '../../../support/errors';

describe('resolveException', () => {
  describe('AppError', () => {
    it('is sent as thrown, with its status, details and retry time', () => {
      const error = new AppError(
        'RATE_LIMITED',
        undefined,
        { scope: 'email' },
        { retryAfterSeconds: 30 },
      );
      expect(resolveException(error)).toEqual({
        status: 429,
        code: 'RATE_LIMITED',
        message: ERROR_CATALOGUE.RATE_LIMITED.message,
        details: { scope: 'email' },
        retryAfterSeconds: 30,
        log: 'none',
      });
    });

    it('logs 5xx codes: INTERNAL as an error, SERVICE_UNAVAILABLE as a warning', () => {
      expect(resolveException(new AppError('INTERNAL')).log).toBe('error');
      expect(resolveException(new AppError('SERVICE_UNAVAILABLE')).log).toBe('warn');
      expect(resolveException(new AppError('NOT_FOUND')).log).toBe('none');
    });
  });

  describe("Nest's HTTP exceptions", () => {
    it('maps a 400 to VALIDATION_FAILED, keeping a plain-string message such as a JSON parse error', () => {
      const resolved = resolveException(new BadRequestException('Unexpected end of JSON input'));
      expect(resolved).toMatchObject({
        status: 400,
        code: 'VALIDATION_FAILED',
        message: 'Unexpected end of JSON input',
        details: null,
        log: 'none',
      });
    });

    it('uses the default message when a 400 carries a list of messages', () => {
      const resolved = resolveException(new BadRequestException(['a must be a string']));
      expect(resolved.message).toBe(ERROR_CATALOGUE.VALIDATION_FAILED.message);
    });

    it('names the method and path of an unmatched route', () => {
      const resolved = resolveException(new NotFoundException('Cannot GET /api/v1/nope?x=1'), {
        method: 'GET',
        path: '/api/v1/nope',
      });
      expect(resolved).toMatchObject({
        status: 404,
        code: 'NOT_FOUND',
        message: 'No route matches GET /api/v1/nope.',
      });
    });

    it('uses the default message for any other 404', () => {
      const resolved = resolveException(new NotFoundException('Booking MQ-ABC123 not found'));
      expect(resolved.message).toBe(ERROR_CATALOGUE.NOT_FOUND.message);
    });

    it.each([
      [new UnauthorizedException(), 401, 'UNAUTHENTICATED', 'none'],
      [new ForbiddenException(), 403, 'FORBIDDEN', 'none'],
      [new PayloadTooLargeException(), 413, 'PAYLOAD_TOO_LARGE', 'none'],
      [
        new HttpException('ThrottlerException: Too Many Requests', 429),
        429,
        'RATE_LIMITED',
        'none',
      ],
      [new ServiceUnavailableException(), 503, 'SERVICE_UNAVAILABLE', 'warn'],
    ])('maps %p to %i %s', (exception, status, code, log) => {
      const resolved = resolveException(exception);
      expect(resolved).toMatchObject({ status, code, log, details: null });
      expect(resolved.message).toBe(ERROR_CATALOGUE[code as keyof typeof ERROR_CATALOGUE].message);
    });

    it('treats an unmapped HTTP exception as a bug: INTERNAL, logged', () => {
      expect(resolveException(new ImATeapotException())).toMatchObject({
        status: 500,
        code: 'INTERNAL',
        log: 'error',
      });
      expect(resolveException(new InternalServerErrorException('db password is x'))).toMatchObject({
        status: 500,
        code: 'INTERNAL',
        message: ERROR_CATALOGUE.INTERNAL.message,
      });
    });
  });

  describe('body parser errors', () => {
    it('maps a body over the limit to PAYLOAD_TOO_LARGE', () => {
      const resolved = resolveException(
        bodyParserError('entity.too.large', 413, 'request entity too large'),
      );
      expect(resolved).toMatchObject({
        status: 413,
        code: 'PAYLOAD_TOO_LARGE',
        details: null,
        log: 'none',
      });
    });

    it('maps other unreadable bodies to VALIDATION_FAILED', () => {
      const resolved = resolveException(
        bodyParserError('charset.unsupported', 415, 'unsupported charset "KOI8-R"'),
      );
      expect(resolved).toMatchObject({
        status: 400,
        code: 'VALIDATION_FAILED',
        message: 'The request body could not be read.',
      });
    });

    it("does not mistake another library's error with a type and a status for a body error", () => {
      const providerError = Object.assign(new Error('Invalid `to` field'), {
        type: 'validation_error',
        status: 422,
      });
      expect(resolveException(providerError)).toMatchObject({
        status: 500,
        code: 'INTERNAL',
        log: 'error',
      });
    });

    it('treats a body parser failure on our side as INTERNAL', () => {
      const resolved = resolveException(
        bodyParserError('stream.not.readable', 500, 'stream is not readable'),
      );
      expect(resolved).toMatchObject({ status: 500, code: 'INTERNAL', log: 'error' });
    });
  });

  describe('database errors', () => {
    it.each([
      ['connection refused', socketError('ECONNREFUSED')],
      ['a pool timeout', new KnexTimeoutError('Knex: Timeout acquiring a connection.')],
      ['an admin shutdown', postgresError({ code: '57P01' })],
    ])('maps %s to SERVICE_UNAVAILABLE, logged as a warning', (_label, error) => {
      expect(resolveException(error)).toEqual({
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: ERROR_CATALOGUE.SERVICE_UNAVAILABLE.message,
        details: null,
        log: 'warn',
      });
    });

    it('maps an unhandled unique violation to CONFLICT with the constraint name only', () => {
      const error = postgresError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "uq_customers_email"',
        constraint: 'uq_customers_email',
        detail: 'Key (email)=(mona@example.com) already exists.',
      });
      const resolved = resolveException(error);
      expect(resolved).toEqual({
        status: 409,
        code: 'CONFLICT',
        message: ERROR_CATALOGUE.CONFLICT.message,
        details: { constraint: 'uq_customers_email' },
        log: 'warn',
      });
      expect(JSON.stringify(resolved)).not.toContain('mona@example.com');
    });

    it('maps an exclusion violation (overlapping showtimes) to CONFLICT', () => {
      const resolved = resolveException(
        postgresError({ code: '23P01', constraint: 'ex_showtimes_hall_time' }),
      );
      expect(resolved).toMatchObject({
        code: 'CONFLICT',
        details: { constraint: 'ex_showtimes_hall_time' },
      });
    });

    it('maps any other database error to INTERNAL', () => {
      expect(resolveException(postgresError({ code: '42P01' }))).toMatchObject({
        code: 'INTERNAL',
        log: 'error',
      });
    });
  });

  it.each([
    ['an Error', new Error('boom')],
    ['a thrown string', 'boom'],
    ['null', null],
  ])('maps %s to INTERNAL with the generic message', (_label, thrown) => {
    expect(resolveException(thrown)).toEqual({
      status: 500,
      code: 'INTERNAL',
      message: 'Something went wrong on our side.',
      details: null,
      log: 'error',
    });
  });
});

describe('resolveRetryAfterSeconds', () => {
  const rateLimited = resolveException(new HttpException('Too Many Requests', 429));

  it("prefers the error's own retry time", () => {
    const resolved = resolveException(
      new AppError('RATE_LIMITED', undefined, null, { retryAfterSeconds: 12 }),
    );
    expect(resolveRetryAfterSeconds(resolved, { 'retry-after': '99' })).toBe(12);
  });

  it('keeps a Retry-After header a guard already set', () => {
    expect(resolveRetryAfterSeconds(rateLimited, { 'retry-after': '17' })).toBe(17);
  });

  it("uses the largest of @nestjs/throttler's named Retry-After-<name> headers", () => {
    const headers = {
      'retry-after-short': '5',
      'retry-after-long': 3600,
      'x-ratelimit-limit': '10',
    };
    expect(resolveRetryAfterSeconds(rateLimited, headers)).toBe(3600);
  });

  it('rounds up to whole seconds, and never answers less than 1', () => {
    expect(resolveRetryAfterSeconds(rateLimited, { 'retry-after': '2.2' })).toBe(3);
    expect(resolveRetryAfterSeconds(rateLimited, { 'retry-after': '0' })).toBe(1);
  });

  it('falls back to the default when there is no usable value', () => {
    expect(resolveRetryAfterSeconds(rateLimited, {})).toBe(DEFAULT_RETRY_AFTER_SECONDS);
    expect(resolveRetryAfterSeconds(rateLimited, { 'retry-after': 'soon' })).toBe(
      DEFAULT_RETRY_AFTER_SECONDS,
    );
    expect(DEFAULT_RETRY_AFTER_SECONDS).toBe(60);
  });
});
