import type { OutgoingHttpHeaders } from 'node:http';
import { HttpException } from '@nestjs/common';
import { isConstraintConflict, isDatabaseUnavailableError } from '../database/postgres-errors';
import { AppError } from './app-error';
import { ERROR_CATALOGUE } from './error-catalogue';
import type {
  BodyParserError,
  ErrorCode,
  ErrorDetails,
  ErrorLogLevel,
  RequestSummary,
  ResolvedError,
} from './types';

/** Used when a 429 carries no retry time of its own; matches the widest window (1 minute). */
export const DEFAULT_RETRY_AFTER_SECONDS = 60;

/** Nest's own HTTP exceptions, by status, mapped onto catalogue codes. Anything else is a bug. */
const HTTP_STATUS_CODES: Readonly<Record<number, ErrorCode>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

function fromCode(
  code: ErrorCode,
  log: ErrorLogLevel,
  overrides: { message?: string; details?: ErrorDetails | null } = {},
): ResolvedError {
  const { status, message } = ERROR_CATALOGUE[code];
  return {
    status,
    code,
    message: overrides.message ?? message,
    details: overrides.details ?? null,
    log,
  };
}

/**
 * Decides the error response for anything thrown while handling a request (design §14.3):
 * `AppError` as thrown, Nest's own exceptions by status, body-parser failures, database
 * outages as `SERVICE_UNAVAILABLE`, unhandled unique and exclusion violations as `CONFLICT`,
 * and everything else as `INTERNAL`.
 */
export function resolveException(exception: unknown, request: RequestSummary = {}): ResolvedError {
  if (exception instanceof AppError) {
    return {
      status: exception.status,
      code: exception.code,
      message: exception.message,
      details: exception.details,
      ...(exception.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: exception.retryAfterSeconds }),
      log: logLevelForStatus(exception.status, exception.code),
    };
  }
  if (exception instanceof HttpException) {
    return resolveHttpException(exception, request);
  }
  if (isBodyParserError(exception)) {
    if (exception.type === 'entity.too.large') return fromCode('PAYLOAD_TOO_LARGE', 'none');
    if (exception.status < 500) {
      return fromCode('VALIDATION_FAILED', 'none', {
        message: 'The request body could not be read.',
      });
    }
  }
  if (isDatabaseUnavailableError(exception)) {
    return fromCode('SERVICE_UNAVAILABLE', 'warn');
  }
  if (isConstraintConflict(exception)) {
    return fromCode('CONFLICT', 'warn', {
      details: exception.constraint ? { constraint: exception.constraint } : null,
    });
  }
  return fromCode('INTERNAL', 'error');
}

function resolveHttpException(exception: HttpException, request: RequestSummary): ResolvedError {
  const code = HTTP_STATUS_CODES[exception.getStatus()];
  if (code === undefined) {
    // Services throw AppError, so an unmapped HttpException is a bug worth a stack trace.
    return fromCode('INTERNAL', 'error');
  }
  if (code === 'VALIDATION_FAILED') {
    const message = httpExceptionMessage(exception);
    return fromCode(code, 'none', message ? { message } : {});
  }
  if (code === 'NOT_FOUND' && isRouteNotFound(exception) && request.method && request.path) {
    return fromCode(code, 'none', {
      message: `No route matches ${request.method} ${request.path}.`,
    });
  }
  return fromCode(code, logLevelForStatus(ERROR_CATALOGUE[code].status, code));
}

function logLevelForStatus(status: number, code: ErrorCode): ErrorLogLevel {
  if (status < 500) return 'none';
  return code === 'SERVICE_UNAVAILABLE' ? 'warn' : 'error';
}

/** The message of a Nest exception when it is a plain string, such as a JSON parse error. */
function httpExceptionMessage(exception: HttpException): string | undefined {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  const { message } = response as { message?: unknown };
  return typeof message === 'string' ? message : undefined;
}

/** Nest answers an unmatched route with `NotFoundException('Cannot GET /path')`. */
function isRouteNotFound(exception: HttpException): boolean {
  return httpExceptionMessage(exception)?.startsWith('Cannot ') ?? false;
}

export function isBodyParserError(error: unknown): error is BodyParserError {
  if (!(error instanceof Error)) return false;
  const { type, status } = error as Partial<BodyParserError>;
  return typeof type === 'string' && typeof status === 'number';
}

/**
 * Seconds for the `Retry-After` header of a `RATE_LIMITED` response, from the first source that
 * has one: the error itself, a `Retry-After` header a guard already set, the largest
 * `Retry-After-<name>` header (@nestjs/throttler's named limits), or the default.
 */
export function resolveRetryAfterSeconds(
  resolved: ResolvedError,
  headers: OutgoingHttpHeaders,
): number {
  const seconds = retryAfterCandidates(resolved, headers)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (seconds.length === 0) return DEFAULT_RETRY_AFTER_SECONDS;
  return Math.max(1, Math.ceil(Math.max(...seconds)));
}

function retryAfterCandidates(resolved: ResolvedError, headers: OutgoingHttpHeaders): unknown[] {
  if (resolved.retryAfterSeconds !== undefined) return [resolved.retryAfterSeconds];
  if (headers['retry-after'] !== undefined) return [headers['retry-after']];
  return Object.entries(headers)
    .filter(([name]) => name.startsWith('retry-after-'))
    .map(([, value]) => value);
}
