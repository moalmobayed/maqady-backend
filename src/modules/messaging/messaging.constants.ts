/** How many due messages one claim takes (design §13.1: "write requests drain a few"). */
export const CLAIM_BATCH_SIZE = 10;

/**
 * How long a claimed message is hidden from other drains while it is being sent. It outlasts a
 * full batch (10 sends × the 10-second timeout, plus pacing), so no other drain can claim a row
 * still in flight. After a crash the row is retried once the lease ends.
 */
export const CLAIM_LEASE_MINUTES = 5;

/** The 10th retryable failure marks a message `failed` with `attempts_exhausted`. */
export const MAX_SEND_ATTEMPTS = 10;

/** Minutes to wait after retryable attempt n (1-based); the last value repeats. */
export const RETRY_BACKOFF_MINUTES = [1, 5, 15, 60, 180, 360] as const;

/** A `flush` drain stops after this many batches: 100 emails, Resend's free daily cap. */
export const FLUSH_MAX_BATCHES = 10;

/** How long shutdown waits for a running drain to finish. */
export const SHUTDOWN_WAIT_MS = 5_000;

/** What a one-time link becomes in every stored copy of a message. */
export const REDACTED_LINK = '[one-time link hidden]';

/** `<owner>.<event>`, as `chk_messages_template` requires. */
export const TEMPLATE_NAME_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/** A plausible email address; callers validate user input properly before queueing. */
export const EMAIL_RECIPIENT_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_EMAIL_RECIPIENT_LENGTH = 320;

/** An E.164 phone number, such as +201001234567. */
export const SMS_RECIPIENT_PATTERN = /^\+[1-9]\d{7,14}$/;

/** What `last_error_code` may hold (`chk_messages_last_error_code`). */
export const ERROR_CODE_PATTERN = /^[a-z0-9_]{1,64}$/;

/** A Resend error `name` worth storing as it is. */
export const RESEND_ERROR_NAME_PATTERN = /^[a-z_]{1,64}$/;

/** Error codes the outbox itself records. */
export const OUTBOX_ERROR_CODES = {
  attemptsExhausted: 'attempts_exhausted',
  renderFailed: 'render_failed',
  templateUnknown: 'template_unknown',
  invalidResponse: 'invalid_response',
  networkError: 'network_error',
  timeout: 'timeout',
  /** A sender's code that `last_error_code` can't hold as it is. */
  providerError: 'provider_error',
} as const;

/** Marks a handler whose `200` starts a `flush` drain (`@DrainOutboxAfterResponse()`). */
export const DRAIN_AFTER_RESPONSE_METADATA = 'maqady:drainOutboxAfterResponse';

/** Resend's send-email endpoint (ADR 0004). */
export const RESEND_EMAILS_URL = 'https://api.resend.com/emails';

/** A Resend call that takes longer is abandoned and retried later. */
export const RESEND_TIMEOUT_MS = 10_000;

/** Resend's default rate limit is 2 requests per second; calls are spaced to stay under it. */
export const RESEND_MIN_INTERVAL_MS = 500;

/** A 429 without a usable `Retry-After` waits this long; a usable one is clamped to the range. */
export const DEFAULT_RETRY_AFTER_SECONDS = 60;
export const MIN_RETRY_AFTER_SECONDS = 1;
export const MAX_RETRY_AFTER_SECONDS = 3_600;

/** Quota refusals: they wait for the next 00:00 UTC (spec "Decisions"). */
export const RESEND_QUOTA_ERRORS: ReadonlySet<string> = new Set([
  'daily_quota_exceeded',
  'monthly_quota_exceeded',
]);

/** API-key problems are retried, so fixing the key later flushes the queue. */
export const RESEND_KEY_ERRORS: ReadonlySet<string> = new Set([
  'missing_api_key',
  'invalid_api_key',
  'restricted_api_key',
]);

/** A 409 that means "the same key is still being processed": try again later. */
export const RESEND_RETRYABLE_CONFLICTS: ReadonlySet<string> = new Set([
  'concurrent_idempotent_requests',
]);
