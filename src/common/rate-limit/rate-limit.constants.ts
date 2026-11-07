import type { RateLimitDefinition, RateLimitName, RateLimitRule } from './types';

/** Metadata key `@RateLimit(...)` writes: the named limits a route opts into. */
export const RATE_LIMITS_METADATA = 'maqady:rate-limits';

/**
 * Design §10.6. Each rule is `<count>/<window>`, the window in seconds (`s`), minutes (`m`) or
 * hours (`h`); the variable overrides it, so tests and environments can raise or lower a limit.
 */
export const RATE_LIMIT_DEFINITIONS: Readonly<Record<RateLimitName, RateLimitDefinition>> = {
  default: { defaultRule: '300/1m', key: 'customerOrIp', variable: 'RATE_LIMIT_DEFAULT' },
  signInEmail: { defaultRule: '5/1m', key: 'ipAndEmail', variable: 'RATE_LIMIT_SIGN_IN_EMAIL' },
  signInIp: { defaultRule: '20/1m', key: 'ip', variable: 'RATE_LIMIT_SIGN_IN_IP' },
  registrationIp: { defaultRule: '5/1h', key: 'ip', variable: 'RATE_LIMIT_REGISTRATION_IP' },
  emailRequestEmail: {
    defaultRule: '3/1h',
    key: 'email',
    variable: 'RATE_LIMIT_EMAIL_REQUEST_EMAIL',
  },
  emailRequestIp: { defaultRule: '20/1h', key: 'ip', variable: 'RATE_LIMIT_EMAIL_REQUEST_IP' },
  // Resend verification has no body.email; a customer's email is fixed, so per customer is per email.
  verificationResendCustomer: {
    defaultRule: '3/1h',
    key: 'customer',
    variable: 'RATE_LIMIT_VERIFICATION_RESEND_CUSTOMER',
  },
  holdIp: { defaultRule: '30/10m', key: 'ip', variable: 'RATE_LIMIT_HOLD_IP' },
  holdCustomer: { defaultRule: '10/10m', key: 'customer', variable: 'RATE_LIMIT_HOLD_CUSTOMER' },
  payment: { defaultRule: '10/5m', key: 'bookingRef', variable: 'RATE_LIMIT_PAYMENT' },
  // Per booking and caller: the throttler runs before the access guard, so a booking-only key
  // would let anyone who knows a reference spend the owner's sends (U12).
  ticketEmail: {
    defaultRule: '3/1h',
    key: 'customerAndBookingRef',
    variable: 'RATE_LIMIT_TICKET_EMAIL',
  },
  search: { defaultRule: '60/1m', key: 'ip', variable: 'RATE_LIMIT_SEARCH' },
};

/** `<count>/<window>`: a positive count, and a window such as `90s`, `10m` or `1h`. */
export const RATE_LIMIT_RULE_PATTERN = /^([1-9][0-9]{0,6})\/([1-9][0-9]{0,4})([smh])$/;

const WINDOW_UNIT_SECONDS = { s: 1, m: 60, h: 3600 } as const;

/** Parses a rule such as `300/1m`; undefined when it is malformed. */
export function parseRateLimitRule(value: string): RateLimitRule | undefined {
  const match = RATE_LIMIT_RULE_PATTERN.exec(value.trim());
  if (!match) return undefined;
  const [, count, amount, unit] = match as unknown as [string, string, string, 's' | 'm' | 'h'];
  return { limit: Number(count), windowSeconds: Number(amount) * WINDOW_UNIT_SECONDS[unit] };
}
