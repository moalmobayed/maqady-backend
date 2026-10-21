import type { ERROR_CATALOGUE } from './error-catalogue';

/** One entry of the error catalogue. */
export interface ErrorDefinition {
  /** The HTTP status this code is always sent with. */
  readonly status: number;
  /** The message used when the thrower gives none. Human-readable; clients don't parse it. */
  readonly message: string;
  /** What the code means and what a client should do; published in the API documentation. */
  readonly description: string;
}

/** A stable, machine-readable error code, for example `NOT_FOUND`. */
export type ErrorCode = keyof typeof ERROR_CATALOGUE;

/** Extra structured information on an error; its shape depends on the code. */
export type ErrorDetails = Readonly<Record<string, unknown>>;

export interface AppErrorOptions {
  /** The underlying error, logged (sanitized) when the error is a 5xx. */
  readonly cause?: unknown;
  /** `RATE_LIMITED` only: seconds until the client may retry, sent as `Retry-After`. */
  readonly retryAfterSeconds?: number;
}

/** The `error` object of every error response. */
export interface ErrorBody {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details: ErrorDetails | null;
  /** Equals the `X-Request-Id` response header. */
  readonly correlationId: string;
}

/** Every error response: `{ "error": { "code", "message", "details", "correlationId" } }`. */
export interface ErrorResponseBody {
  readonly error: ErrorBody;
}

/** One invalid field of a request, in `VALIDATION_FAILED` details. */
export interface FieldError {
  /** Dotted path into the request, for example `seats.0.label`. */
  readonly field: string;
  readonly messages: readonly string[];
}

/** How the filter logs a resolved error: unexpected ones with their stack, outages as warnings. */
export type ErrorLogLevel = 'error' | 'warn' | 'none';

/** The response the filter decided on for something that was thrown. */
export interface ResolvedError {
  readonly status: number;
  readonly code: ErrorCode;
  readonly message: string;
  readonly details: ErrorDetails | null;
  readonly retryAfterSeconds?: number;
  readonly log: ErrorLogLevel;
}

/** The parts of a request the error mapping reads. */
export interface RequestSummary {
  readonly method?: string;
  readonly path?: string;
}

/** An error raised by Express's body parser (the `http-errors` shape). */
export interface BodyParserError extends Error {
  readonly type: string;
  readonly status: number;
}
