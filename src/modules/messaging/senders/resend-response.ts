import { addToInstant, startOfNextUtcDay } from '../../../common/time/time';
import {
  DEFAULT_RETRY_AFTER_SECONDS,
  MAX_RETRY_AFTER_SECONDS,
  MIN_RETRY_AFTER_SECONDS,
  OUTBOX_ERROR_CODES,
  RESEND_ERROR_NAME_PATTERN,
  RESEND_KEY_ERRORS,
  RESEND_QUOTA_ERRORS,
  RESEND_RETRYABLE_CONFLICTS,
} from '../messaging.constants';
import type { ResendResponseBody, SendOutcome } from '../types';

/**
 * How Resend's answer becomes a `SendOutcome` (spec "ResendEmailSender"). Only Resend's error
 * `name` is kept, and only when it looks like one: its `message` can echo the recipient.
 */
export function outcomeOfResponse(
  status: number,
  body: ResendResponseBody | undefined,
  retryAfter: string | null,
  now: Date,
): SendOutcome {
  if (status >= 200 && status < 300) {
    const id = body?.id;
    return typeof id === 'string' && id !== ''
      ? { kind: 'sent', providerMessageId: id }
      : { kind: 'retry', errorCode: OUTBOX_ERROR_CODES.invalidResponse };
  }

  const name = errorNameOf(body);
  const errorCode = name ?? `http_${status}`;

  if (status === 429) {
    if (name !== undefined && RESEND_QUOTA_ERRORS.has(name)) {
      return { kind: 'throttled', errorCode, retryAt: startOfNextUtcDay(now) };
    }
    return {
      kind: 'throttled',
      errorCode,
      retryAt: addToInstant(now, { seconds: retryAfterSeconds(retryAfter) }),
    };
  }
  if ((status === 401 || status === 403) && name !== undefined && RESEND_KEY_ERRORS.has(name)) {
    return { kind: 'retry', errorCode };
  }
  if (status === 409 && name !== undefined && RESEND_RETRYABLE_CONFLICTS.has(name)) {
    return { kind: 'retry', errorCode };
  }
  if (status >= 400 && status < 500) return { kind: 'rejected', errorCode };
  return { kind: 'retry', errorCode };
}

/** A fetch that never got an answer: a timeout or a network problem, both worth retrying. */
export function outcomeOfFetchError(error: unknown): SendOutcome {
  // AbortSignal.timeout() rejects with a DOMException, which is not always an `Error` instance.
  const name =
    typeof error === 'object' && error !== null && 'name' in error ? error.name : undefined;
  const timedOut = name === 'TimeoutError' || name === 'AbortError';
  return {
    kind: 'retry',
    errorCode: timedOut ? OUTBOX_ERROR_CODES.timeout : OUTBOX_ERROR_CODES.networkError,
  };
}

/** `Retry-After` in whole seconds, clamped to 1–3600; 60 when absent or not a number. */
export function retryAfterSeconds(header: string | null): number {
  const text = header?.trim();
  const parsed = text ? Number(text) : Number.NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_RETRY_AFTER_SECONDS;
  return Math.min(Math.max(Math.ceil(parsed), MIN_RETRY_AFTER_SECONDS), MAX_RETRY_AFTER_SECONDS);
}

function errorNameOf(body: ResendResponseBody | undefined): string | undefined {
  const name = body?.name;
  return typeof name === 'string' && RESEND_ERROR_NAME_PATTERN.test(name) ? name : undefined;
}
