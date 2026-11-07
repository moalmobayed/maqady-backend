/**
 * The named rate limits of design §10.6. `default` applies to every route; the others apply
 * only to routes that opt in with `@RateLimit(...)`.
 */
export const RATE_LIMIT_NAMES = [
  'default',
  'signInEmail',
  'signInIp',
  'registrationIp',
  'emailRequestEmail',
  'emailRequestIp',
  'verificationResendCustomer',
  'holdIp',
  'holdCustomer',
  'payment',
  'ticketEmail',
  'search',
] as const;

/**
 * What a limit counts by.
 *
 * - `ip`: the client address (one trusted proxy hop).
 * - `customerOrIp`: the signed-in customer, else the client address.
 * - `customer`: the signed-in customer; the limit is skipped for anyone else.
 * - `email`: `body.email`, lower-cased and hashed.
 * - `ipAndEmail`: the client address plus the hashed `body.email`.
 * - `bookingRef`: the `ref` path parameter.
 * - `customerAndBookingRef`: the signed-in customer (else the client address) plus the `ref` path
 *   parameter, so nobody but the owner can spend a booking's limit (U12 "Email again").
 */
export const RATE_LIMIT_KEYS = [
  'ip',
  'customerOrIp',
  'customer',
  'email',
  'ipAndEmail',
  'bookingRef',
  'customerAndBookingRef',
] as const;
