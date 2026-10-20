import type { PostgresError } from './types';

/** SQLSTATE codes this service reacts to (PostgreSQL 16, Appendix A). */
export const SQLSTATE = {
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
  UNIQUE_VIOLATION: '23505',
  EXCLUSION_VIOLATION: '23P01',
  ADMIN_SHUTDOWN: '57P01',
  CRASH_SHUTDOWN: '57P02',
  CANNOT_CONNECT_NOW: '57P03',
  TOO_MANY_CONNECTIONS: '53300',
} as const;

/** Constraint violations that, when no service handled them, mean "conflicting data". */
const CONFLICT_SQLSTATES = new Set<string>([
  SQLSTATE.UNIQUE_VIOLATION,
  SQLSTATE.EXCLUSION_VIOLATION,
]);

/** Failures where re-running the whole transaction can succeed (design §7.1, §14.1). */
const RETRYABLE_SQLSTATES = new Set<string>([
  SQLSTATE.SERIALIZATION_FAILURE,
  SQLSTATE.DEADLOCK_DETECTED,
]);

/** Server-side states in which no query can succeed until the database is back. */
const UNAVAILABLE_SQLSTATES = new Set<string>([
  SQLSTATE.ADMIN_SHUTDOWN,
  SQLSTATE.CRASH_SHUTDOWN,
  SQLSTATE.CANNOT_CONNECT_NOW,
  SQLSTATE.TOO_MANY_CONNECTIONS,
]);

/** Socket-level failures Node reports when the database host can't be reached. */
const UNAVAILABLE_SOCKET_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
]);

/** Errors node-pg raises without a code: a connect timeout and a dropped connection. */
const UNAVAILABLE_MESSAGES = [/^timeout expired$/, /^Connection terminated( unexpectedly)?$/];

const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;
const MAX_CAUSE_DEPTH = 5;

/** True for an error raised by the Postgres server (node-pg `DatabaseError`). */
export function isPostgresError(error: unknown): error is PostgresError {
  if (!(error instanceof Error)) return false;
  const { code, severity } = error as Partial<PostgresError>;
  return typeof code === 'string' && SQLSTATE_PATTERN.test(code) && typeof severity === 'string';
}

/** True for a unique or exclusion violation that reached the filter unhandled. */
export function isConstraintConflict(error: unknown): error is PostgresError {
  return isPostgresError(error) && CONFLICT_SQLSTATES.has(error.code);
}

/**
 * True when the database can't be reached or can't serve queries right now: connection refused or
 * dropped, connect or pool timeout, SQLSTATE class 08, server shutdown or too many connections.
 * Follows `cause` chains and `AggregateError`s, because drivers wrap socket errors.
 */
export function isDatabaseUnavailableError(error: unknown, depth = 0): boolean {
  if (!(error instanceof Error) || depth > MAX_CAUSE_DEPTH) return false;
  if (error.name === 'KnexTimeoutError') return true;

  if (isPostgresError(error)) {
    return error.code.startsWith('08') || UNAVAILABLE_SQLSTATES.has(error.code);
  }

  const { code } = error as { code?: unknown };
  if (typeof code === 'string' && UNAVAILABLE_SOCKET_CODES.has(code)) return true;
  if (UNAVAILABLE_MESSAGES.some((pattern) => pattern.test(error.message))) return true;

  if (error instanceof AggregateError) {
    const nested: unknown[] = error.errors;
    if (nested.some((inner) => isDatabaseUnavailableError(inner, depth + 1))) return true;
  }
  return isDatabaseUnavailableError(error.cause, depth + 1);
}

/**
 * True for a deadlock (`40P01`) or a serialization failure (`40001`), on the error itself or
 * anywhere in its `cause` chain (a service may wrap the driver error in an `AppError`).
 */
export function isRetryableTransactionError(error: unknown, depth = 0): boolean {
  if (!(error instanceof Error) || depth > MAX_CAUSE_DEPTH) return false;
  if (isPostgresError(error) && RETRYABLE_SQLSTATES.has(error.code)) return true;
  return isRetryableTransactionError(error.cause, depth + 1);
}
