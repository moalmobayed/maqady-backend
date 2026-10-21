import type { RATE_LIMIT_KEYS, RATE_LIMIT_NAMES } from './enums';

export type RateLimitName = (typeof RATE_LIMIT_NAMES)[number];

/** A limit other than `default`, which a route opts into with `@RateLimit(...)`. */
export type NamedRateLimit = Exclude<RateLimitName, 'default'>;

export type RateLimitKey = (typeof RATE_LIMIT_KEYS)[number];

/** One limit: at most `limit` requests per `windowSeconds`. */
export interface RateLimitRule {
  readonly limit: number;
  readonly windowSeconds: number;
}

/** Every limit, as configured (design §10.6 defaults, overridable per environment). */
export type RateLimitsConfig = Readonly<Record<RateLimitName, RateLimitRule>>;

/** The fixed part of a limit's definition: its default rule, its key and its variable name. */
export interface RateLimitDefinition {
  readonly defaultRule: string;
  readonly key: RateLimitKey;
  /** The environment variable that overrides the default, for example `RATE_LIMIT_SIGN_IN_IP`. */
  readonly variable: string;
}
