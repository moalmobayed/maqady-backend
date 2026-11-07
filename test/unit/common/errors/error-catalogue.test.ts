import { ERROR_CATALOGUE } from '../../../../src/common/errors/error-catalogue';

/** Design §14.3: the initial catalogue and the codes later units added, each with its one status. */
const DESIGN_CATALOGUE: Record<string, number> = {
  VALIDATION_FAILED: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  INVALID_TOKEN: 400,
  INVALID_CREDENTIALS: 401,
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  SESSION_REVOKED: 401,
  ACCOUNT_BLOCKED: 403,
  ACCOUNT_DEACTIVATED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  REFRESH_CONFLICT: 409,
  SEAT_TAKEN: 409,
  HOLD_EXPIRED: 409,
  HOLD_ALREADY_CLAIMED: 409,
  ALREADY_PAID: 409,
  PAYMENT_IN_PROGRESS: 409,
  SHOWTIME_NOT_BOOKABLE: 409,
  SHOWTIME_CONFLICT: 409,
  HALL_IN_USE: 409,
  BOOKING_NOT_EDITABLE: 409,
  LAST_ADMIN: 409,
  NOT_INVITED: 409,
  EMAIL_TAKEN: 409,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  IDEMPOTENCY_KEY_REUSED: 422,
  TIME_DOES_NOT_EXIST: 422,
  OUTSIDE_OPENING_HOURS: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  SERVICE_UNAVAILABLE: 503,
};

/**
 * The codes later units added, each with its status (U4a: `docs/gh-5-media/spec.md`; U4b:
 * `docs/gh-5-theaters/spec.md`; U6: `docs/gh-7-catalog/spec.md`; U5: `docs/gh-6-halls/spec.md`; U7:
 * `docs/gh-8-showtimes/spec.md`; U11: `docs/gh-12-checkout/spec.md`; U14:
 * `docs/gh-15-admin-bookings/spec.md`).
 */
const UNIT_CODES: Record<string, number> = {
  IMAGE_TOO_LARGE: 413,
  UNSUPPORTED_IMAGE_TYPE: 415,
  IMAGE_TOO_MANY_PIXELS: 422,
  IMAGE_WRONG_SHAPE: 422,
  STORAGE_UNAVAILABLE: 503,
  THEATER_NOT_PUBLISHABLE: 409,
  THEATER_NOT_DELETABLE: 409,
  MOVIE_NOT_PUBLISHABLE: 409,
  MOVIE_NOT_FEATURABLE: 409,
  FEATURED_POSITION_TAKEN: 409,
  MOVIE_NOT_DELETABLE: 409,
  HALL_NOT_DELETABLE: 409,
  HALL_NOT_RETIRABLE: 409,
  SHOWTIME_NOT_SCHEDULABLE: 409,
  SHOWTIMES_NOT_CREATED: 409,
  SHOWTIME_NOT_EDITABLE: 409,
  TICKET_NOT_AVAILABLE: 409,
  BOOKING_NOT_REFUNDABLE: 409,
  REFUND_NOT_PENDING: 409,
  NO_CONTACT_DETAILS: 409,
  CUSTOMER_BLOCKED: 409,
};

describe('ERROR_CATALOGUE', () => {
  it('holds every code of design §14.3 and of the later units with its status, and nothing else', () => {
    const statuses = Object.fromEntries(
      Object.entries(ERROR_CATALOGUE).map(([code, { status }]) => [code, status]),
    );
    expect(statuses).toEqual({ ...DESIGN_CATALOGUE, ...UNIT_CODES });
  });

  it('gives every code a default message and a published description', () => {
    for (const definition of Object.values(ERROR_CATALOGUE)) {
      expect(definition.message.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
    }
  });
});
