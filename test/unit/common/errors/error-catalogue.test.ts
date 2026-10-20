import { ERROR_CATALOGUE } from '../../../../src/common/errors/error-catalogue';

/** Design §14.3, the initial catalogue: every code with its one status. */
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

describe('ERROR_CATALOGUE', () => {
  it('holds every code of design §14.3 with its status, and nothing else yet', () => {
    const statuses = Object.fromEntries(
      Object.entries(ERROR_CATALOGUE).map(([code, { status }]) => [code, status]),
    );
    expect(statuses).toEqual(DESIGN_CATALOGUE);
  });

  it('gives every code a default message and a published description', () => {
    for (const definition of Object.values(ERROR_CATALOGUE)) {
      expect(definition.message.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
    }
  });
});
