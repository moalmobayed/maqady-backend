import type { ErrorDefinition } from './types';

/**
 * Every error code the API can return, with its one HTTP status (design §14.3). Units add the
 * codes they introduce here, with a description the API documentation publishes.
 *
 * Codes are part of the public contract: never rename or reuse one.
 */
export const ERROR_CATALOGUE = {
  // --- 400 ---------------------------------------------------------------------------------
  VALIDATION_FAILED: {
    status: 400,
    message: 'The request is not valid.',
    description:
      'The body, query, path or a header failed validation. When the request could be parsed, `details.fields` lists each problem as `{ field, messages }`, with dotted paths such as `seats.0.label` (a header appears under its name, for example `Idempotency-Key`). `details` is null when the body could not be read, for example malformed JSON.',
  },
  IDEMPOTENCY_KEY_REQUIRED: {
    status: 400,
    message: 'This request needs an Idempotency-Key header.',
    description:
      'The route changes something that must not happen twice, so it requires an `Idempotency-Key` header: a new UUID per user action, reused when retrying that same action.',
  },
  INVALID_TOKEN: {
    status: 400,
    message: 'This link is invalid or has expired.',
    description:
      'The emailed token (verification, password reset or invite) is unknown, already used or expired. Ask for a new email.',
  },
  // --- 401 ---------------------------------------------------------------------------------
  INVALID_CREDENTIALS: {
    status: 401,
    message: 'The email or password is incorrect.',
    description: 'Sign-in failed. The answer never says which of the two was wrong.',
  },
  UNAUTHENTICATED: {
    status: 401,
    message: 'Sign in to continue.',
    description:
      'No valid access token was sent: none, malformed, expired, or for the other site (a customer token on an admin route, or the reverse). Refresh the tokens, or sign in, and retry.',
  },
  SESSION_EXPIRED: {
    status: 401,
    message: 'Your session has expired. Sign in again.',
    description: 'The refresh token is past its lifetime. Sign in again.',
  },
  SESSION_REVOKED: {
    status: 401,
    message: 'You were signed out. Sign in again.',
    description:
      'The session was ended: signed out, the account was blocked or deactivated, or an old refresh token was reused. Sign in again.',
  },
  // --- 403 ---------------------------------------------------------------------------------
  ACCOUNT_BLOCKED: {
    status: 403,
    message: 'This account is blocked.',
    description: 'The customer account was blocked by an admin. Contact the cinema.',
  },
  ACCOUNT_DEACTIVATED: {
    status: 403,
    message: 'This staff account is deactivated.',
    description: 'The staff account was deactivated by an admin.',
  },
  FORBIDDEN: {
    status: 403,
    message: 'You do not have access to this.',
    description:
      'The signed-in account may not perform this action, for example a box office account on an admin-only route.',
  },
  // --- 404 ---------------------------------------------------------------------------------
  NOT_FOUND: {
    status: 404,
    message: 'The requested resource was not found.',
    description:
      "The route or the resource doesn't exist. Another customer's resource also answers NOT_FOUND.",
  },
  // --- 409 ---------------------------------------------------------------------------------
  REFRESH_CONFLICT: {
    status: 409,
    message: 'These tokens were just refreshed elsewhere.',
    description:
      'The refresh token was rotated less than 30 seconds ago, typically by another tab. Read the tokens already stored and use those.',
  },
  SEAT_TAKEN: {
    status: 409,
    message: 'Some of these seats were just taken.',
    description:
      'Another customer holds or bought at least one of the seats. `details.seats` lists them; pick other seats.',
  },
  HOLD_EXPIRED: {
    status: 409,
    message: 'Your seat hold has expired.',
    description: 'The hold ran out before this action. Choose the seats again.',
  },
  HOLD_ALREADY_CLAIMED: {
    status: 409,
    message: 'This hold already belongs to an account.',
    description: 'The guest hold was already attached to a customer account.',
  },
  ALREADY_PAID: {
    status: 409,
    message: 'This booking is already paid.',
    description: 'A successful payment exists. Show the tickets instead of paying again.',
  },
  PAYMENT_IN_PROGRESS: {
    status: 409,
    message: 'A payment for this booking is already in progress.',
    description: 'Wait for the processing payment to finish, then read the booking again.',
  },
  SHOWTIME_NOT_BOOKABLE: {
    status: 409,
    message: 'This showtime can no longer be booked.',
    description:
      'The showtime started, was cancelled, or its theater paused sales. Pick another showtime.',
  },
  SHOWTIME_CONFLICT: {
    status: 409,
    message: 'This showtime overlaps another in the same hall.',
    description:
      'Showtimes in a hall must be at least 20 minutes apart, cleaning included. `details` names the overlapping showtime.',
  },
  HALL_IN_USE: {
    status: 409,
    message: 'This hall has seats held or sold in upcoming showtimes.',
    description:
      'The layout cannot change while a showtime that has not ended has a live seat claim. `details.showtimes` lists them.',
  },
  BOOKING_NOT_EDITABLE: {
    status: 409,
    message: 'This booking can no longer be changed.',
    description: 'The booking is refunded, checked in, or its showtime has started.',
  },
  LAST_ADMIN: {
    status: 409,
    message: 'At least one active admin must remain.',
    description: 'Demoting or deactivating this admin would leave no active admin.',
  },
  EMAIL_TAKEN: {
    status: 409,
    message: 'An account with this email already exists.',
    description: 'Sign in instead, or use "Forgot password".',
  },
  CONFLICT: {
    status: 409,
    message: 'The request conflicts with existing data.',
    description:
      'A database constraint refused the change. `details.constraint` names the constraint, never the values.',
  },
  // --- 413 ---------------------------------------------------------------------------------
  PAYLOAD_TOO_LARGE: {
    status: 413,
    message: 'The request body is too large.',
    description: 'JSON bodies are limited to 1 MB.',
  },
  // --- 422 ---------------------------------------------------------------------------------
  IDEMPOTENCY_KEY_REUSED: {
    status: 422,
    message: 'This Idempotency-Key was already used for a different request.',
    description:
      'The key was sent before, within 24 hours, with a different route, path or body. Use a new key for a new action; reuse a key only to retry the identical request.',
  },
  TIME_DOES_NOT_EXIST: {
    status: 422,
    message: 'This time does not exist in Cairo that night.',
    description:
      'The clocks skip this hour for summer time. `details` echoes the `date` and `time`; pick a time after the change.',
  },
  OUTSIDE_OPENING_HOURS: {
    status: 422,
    message: 'This time is outside the theater opening hours.',
    description: 'A showtime must start and end inside the opening hours of its cinema date.',
  },
  // --- 429 ---------------------------------------------------------------------------------
  RATE_LIMITED: {
    status: 429,
    message: 'Too many requests. Try again shortly.',
    description:
      'A rate limit was reached. Wait for the number of seconds in the `Retry-After` header, then retry.',
  },
  // --- 5xx ---------------------------------------------------------------------------------
  INTERNAL: {
    status: 500,
    message: 'Something went wrong on our side.',
    description: 'An unexpected error. Quote `correlationId` when reporting it.',
  },
  SERVICE_UNAVAILABLE: {
    status: 503,
    message: 'The service is temporarily unavailable.',
    description:
      "The database can't be reached right now. Retry after a short wait; the free host may also be waking up.",
  },
} as const satisfies Record<string, ErrorDefinition>;
