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
      'Showtimes in a hall must be at least 20 minutes apart, cleaning included. `details.conflicts` names the overlapping showtimes, each as `{ showtimeId, movieTitle, startsAt, endsAt, cleaningEndsAt }` (Cairo time with its offset).',
  },
  SHOWTIME_NOT_SCHEDULABLE: {
    status: 409,
    message: 'This movie and hall cannot be scheduled.',
    description:
      'Only a Now showing movie in an active hall can be scheduled, with prices (the request\'s, or the theater\'s defaults). `details.reasons` lists what is wrong, from `movie_not_now_showing`, `hall_not_active` and `no_prices`.',
  },
  SHOWTIMES_NOT_CREATED: {
    status: 409,
    message: 'None of these showtimes could be created.',
    description:
      'Nothing was created: no date fitted, or one did not and `skipUnavailable` was false. `details.results` gives every date as `{ cinemaDate, result, conflicts }`, where `result` is `available` (it would have fitted), `conflict`, `outside_opening_hours`, `time_does_not_exist` or `in_past`, and `conflicts` lists `{ showtimeId, movieTitle, startsAt, endsAt, cleaningEndsAt }`. Check the dates with `POST /admin/showtime-checks` and retry with a new key.',
  },
  SHOWTIME_NOT_EDITABLE: {
    status: 409,
    message: 'This showtime can no longer be changed this way.',
    description:
      'A showtime is moved and re-priced only before it starts, and cancelled only before it ends; a cancelled showtime is final. `details.reason` is `started`, `ended` or `cancelled`.',
  },
  HALL_IN_USE: {
    status: 409,
    message: 'This hall has seats held or sold in upcoming showtimes.',
    description:
      'The layout cannot change while a showtime that has not ended has a live seat claim. `details.showtimes` lists them, soonest first and at most 20, each as `{ id, startsAt, movieTitle }` (`startsAt` in Cairo time with its offset).',
  },
  HALL_NOT_DELETABLE: {
    status: 409,
    message: "A hall that ever had a showtime can't be deleted; retire it instead.",
    description:
      'Only a hall that never had a showtime is deleted; any other is retired (`PATCH` `status: retired`) and kept for history. `details.reasons` says why, for example `["has_showtimes"]`.',
  },
  HALL_NOT_RETIRABLE: {
    status: 409,
    message: "A hall with upcoming showtimes can't be retired; move or cancel them first.",
    description:
      'Retiring hides a hall from scheduling, so it needs no scheduled showtime that has not ended. `details.reasons` says why, for example `["has_future_showtimes"]`.',
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
  NOT_INVITED: {
    status: 409,
    message: 'This staff member is not waiting for an invite.',
    description:
      'Only a member who is still `invited` (has not set a password) can be sent an invite again. An active member uses "Forgot password" on the sign-in page; reactivate a deactivated member first.',
  },
  EMAIL_TAKEN: {
    status: 409,
    message: 'An account with this email already exists.',
    description: 'Sign in instead, or use "Forgot password".',
  },
  MOVIE_NOT_PUBLISHABLE: {
    status: 409,
    message: 'Add a synopsis, runtime, release date and at least one genre before publishing.',
    description:
      'A Coming soon or Now showing movie needs a synopsis, a runtime, a release date and at least one genre (a poster is optional). Also answered when an edit would clear one of them on a public movie. `details.missing` lists what is missing, from `synopsis`, `runtimeMinutes`, `releaseDate` and `genres`.',
  },
  MOVIE_NOT_FEATURABLE: {
    status: 409,
    message: 'Only Coming soon or Now showing movies with a hero video can be featured.',
    description:
      'A movie in the home carousel must be Coming soon or Now showing and have a hero video. Also answered when an edit or a video deletion would leave a featured movie without its hero video. `details.reasons` lists `not_public`, `no_hero_video` or both; unfeature the movie first (`featuredPosition: null`).',
  },
  FEATURED_POSITION_TAKEN: {
    status: 409,
    message: 'Another movie holds this carousel position; unfeature it first.',
    description:
      'Each home carousel position holds one movie. `details.position` is the position asked for and `details.movieId` the movie holding it; unfeature that movie or pick another position.',
  },
  MOVIE_NOT_DELETABLE: {
    status: 409,
    message: "A movie that has had bookings can't be deleted; archive it instead.",
    description:
      'Deleting would lose history another part of the system keeps, such as bookings or showtimes. `details.reasons` lists why, for example `has_bookings` or `has_showtimes`. Archive the movie instead.',
  },
  THEATER_NOT_PUBLISHABLE: {
    status: 409,
    message: 'This theater is not ready to publish.',
    description:
      'Publishing a draft theater needs its zone prices, its opening hours (all seven weekdays set, at least one open) and an active hall. `details.missing` lists what is still missing, for example `["prices", "hours", "active_hall"]`, so the page can show a checklist.',
  },
  THEATER_NOT_DELETABLE: {
    status: 409,
    message: 'Only a draft theater with no showtimes can be deleted.',
    description:
      'Pause ticket sales instead: a published theater is never deleted, and neither is a draft with showtimes. `details.reasons` says why, for example `["not_draft"]` or `["has_showtimes"]`.',
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
  IMAGE_TOO_LARGE: {
    status: 413,
    message: 'This image is larger than 10 MB.',
    description:
      'Uploaded photos are limited to 10 MB (`details.maxBytes`). Export a smaller JPG or PNG and upload it again.',
  },
  // --- 415 ---------------------------------------------------------------------------------
  UNSUPPORTED_IMAGE_TYPE: {
    status: 415,
    message: 'Upload a JPG or PNG image.',
    description:
      'The file is not a readable JPG or PNG. The type is read from the file itself, never from its name or `Content-Type`, so a renamed or damaged file is refused too. `details.allowed` lists the accepted types.',
  },
  // --- 422 ---------------------------------------------------------------------------------
  IDEMPOTENCY_KEY_REUSED: {
    status: 422,
    message: 'This Idempotency-Key was already used for a different request.',
    description:
      'The key was sent before, within 24 hours, with a different route, path, body or hold code. Use a new key for a new action; reuse a key only to retry the identical request.',
  },
  TIME_DOES_NOT_EXIST: {
    status: 422,
    message: 'This time does not exist in Cairo that night.',
    description:
      'The clocks skip this hour for summer time. `details` echoes the calendar `date` and the `time` (and, for a showtime, its `cinemaDate`); pick a time after the change.',
  },
  OUTSIDE_OPENING_HOURS: {
    status: 422,
    message: 'This time is outside the theater opening hours.',
    description:
      'A showtime must start and end inside the opening hours of its cinema date (its cleaning may run past closing). `details.window` gives that date\'s `{ opensAt, closesAt }` in Cairo time with its offset, or null when the theater is closed or has no hours that date.',
  },
  IMAGE_TOO_MANY_PIXELS: {
    status: 422,
    message: 'This image has more than 40 megapixels.',
    description:
      "Images are limited to 40 megapixels (`details.maxPixels`); `details.width` and `details.height` give the upload's size. Resize it and upload it again.",
  },
  IMAGE_WRONG_SHAPE: {
    status: 422,
    message: 'This image does not have the required shape or size.',
    description:
      "Posters must be 2:3 and at least 400 × 600; people photos square and at least 600 × 600; covers at least 1280 × 720 once cropped to 16:9; gallery photos at least 320 pixels on the shorter side. A 2:3 or square image may be up to 2 % off and is centre-cropped. `details` gives the `kind`, the required `aspect` (null when any shape is accepted), `minWidth`, `minHeight`, and the upload's `width` and `height` after its EXIF rotation.",
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
  STORAGE_UNAVAILABLE: {
    status: 503,
    message: 'Image storage is temporarily unavailable.',
    description:
      "The image storage service can't be reached right now, so nothing was saved. Retry the upload after a short wait.",
  },
} as const satisfies Record<string, ErrorDefinition>;
