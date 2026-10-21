import { resolve } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { type ValidationError, validateSync } from 'class-validator';
import { RATE_LIMIT_NAMES } from '../rate-limit/enums';
import { parseRateLimitRule, RATE_LIMIT_DEFINITIONS } from '../rate-limit/rate-limit.constants';
import type { RateLimitName, RateLimitRule, RateLimitsConfig } from '../rate-limit/types';
import { EnvironmentVariables } from './environment-variables';
import type { AppConfig, EmailConfig, LogLevel, StorageConfig } from './types';
import { decodeSecret, splitList, trimTrailingSlashes } from './validators';

export const DEFAULT_PORT = 3000;
export const DEFAULT_LOG_LEVEL: LogLevel = 'info';
export const DEFAULT_STORAGE_BUCKET = 'media';
export const DEFAULT_LOCAL_STORAGE_DIR = '.media';
/** Design §10.6: 20 open seat-map connections per IP address, 3 subscriptions each. */
export const DEFAULT_WS_CONNECTIONS_PER_IP = 20;
export const DEFAULT_WS_SUBSCRIPTIONS_PER_CONNECTION = 3;

/** Thrown at boot when the environment is incomplete or malformed. Lists names, never values. */
export class ConfigValidationError extends Error {
  override readonly name = 'ConfigValidationError';

  constructor(readonly problems: readonly string[]) {
    super(`Invalid environment configuration:\n${problems.map((p) => `- ${p}`).join('\n')}`);
  }
}

/**
 * Validates the environment and returns the typed configuration, or throws
 * `ConfigValidationError`. Empty values count as unset, so `PORT=` in `.env` means the default.
 */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): AppConfig {
  const present: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    const trimmed = value?.trim();
    if (trimmed) present[name] = trimmed;
  }

  const variables = plainToInstance(EnvironmentVariables, present);
  const errors = validateSync(variables);
  const problems = errors.map(describeProblem);
  if (
    problems.length === 0 &&
    sameSecret(variables.JWT_SECRET_CUSTOMER, variables.JWT_SECRET_STAFF)
  ) {
    // One secret for both audiences would let a customer token pass as a staff token.
    problems.push('JWT_SECRET_STAFF must differ from JWT_SECRET_CUSTOMER');
  }
  if (problems.length === 0) {
    // A leaked QR key must not forge an access token or open encrypted data, and the reverse.
    const others = [
      variables.JWT_SECRET_CUSTOMER,
      variables.JWT_SECRET_STAFF,
      variables.DATA_ENCRYPTION_KEY,
      ...(variables.DATA_ENCRYPTION_PREVIOUS_KEY ? [variables.DATA_ENCRYPTION_PREVIOUS_KEY] : []),
    ];
    if (others.some((other) => sameSecret(variables.QR_SIGNING_KEY, other))) {
      problems.push('QR_SIGNING_KEY must differ from the JWT secrets and the data encryption keys');
    }
  }
  if (problems.length > 0) {
    throw new ConfigValidationError(problems);
  }

  const port = variables.PORT ?? DEFAULT_PORT;
  return {
    port,
    logLevel: variables.LOG_LEVEL ?? DEFAULT_LOG_LEVEL,
    corsOrigins: splitList(variables.CORS_ORIGINS),
    database: { url: variables.DATABASE_URL, schema: variables.DB_SCHEMA },
    auth: {
      customerTokenSecret: variables.JWT_SECRET_CUSTOMER,
      staffTokenSecret: variables.JWT_SECRET_STAFF,
    },
    encryption: {
      key: variables.DATA_ENCRYPTION_KEY,
      ...(variables.DATA_ENCRYPTION_PREVIOUS_KEY
        ? { previousKey: variables.DATA_ENCRYPTION_PREVIOUS_KEY }
        : {}),
    },
    tickets: { qrSigningKey: variables.QR_SIGNING_KEY },
    rateLimits: rateLimitsFrom(present),
    seatMap: {
      connectionsPerIp: variables.WS_CONNECTIONS_PER_IP ?? DEFAULT_WS_CONNECTIONS_PER_IP,
      subscriptionsPerConnection:
        variables.WS_SUBSCRIPTIONS_PER_CONNECTION ?? DEFAULT_WS_SUBSCRIPTIONS_PER_CONNECTION,
    },
    frontendBaseUrl: trimTrailingSlashes(variables.FRONTEND_BASE_URL),
    email: emailFrom(variables),
    storage: storageFrom(variables, port),
  };
}

/** The storage driver and its settings; the driver's own variables were validated above. */
function storageFrom(variables: EnvironmentVariables, port: number): StorageConfig {
  if (variables.STORAGE_DRIVER === 'supabase') {
    return {
      driver: 'supabase',
      supabaseUrl: variables.SUPABASE_URL ?? '',
      serviceRoleKey: variables.SUPABASE_SERVICE_ROLE_KEY ?? '',
      bucket: variables.STORAGE_BUCKET ?? DEFAULT_STORAGE_BUCKET,
    };
  }
  return {
    driver: 'local',
    directory: resolve(variables.LOCAL_STORAGE_DIR ?? DEFAULT_LOCAL_STORAGE_DIR),
    publicBaseUrl: variables.LOCAL_STORAGE_PUBLIC_URL ?? `http://localhost:${port}/media`,
  };
}

/** The email driver and, for Resend, its key and sender (both validated as present above). */
function emailFrom(variables: EnvironmentVariables): EmailConfig {
  if (variables.EMAIL_DRIVER === 'simulated') return { driver: 'simulated' };
  const { RESEND_API_KEY: apiKey, EMAIL_FROM: from } = variables;
  if (apiKey === undefined || from === undefined) {
    throw new ConfigValidationError(['RESEND_API_KEY and EMAIL_FROM are required for Resend']);
  }
  return { driver: 'resend', apiKey, from };
}

function sameSecret(first: string, second: string): boolean {
  const a = decodeSecret(first);
  const b = decodeSecret(second);
  return a !== undefined && b !== undefined && a.equals(b);
}

/** Every limit of design §10.6: the variable when set (already validated), else the default. */
function rateLimitsFrom(present: Readonly<Record<string, string>>): RateLimitsConfig {
  const entries = RATE_LIMIT_NAMES.map((name): [RateLimitName, RateLimitRule] => {
    const { variable, defaultRule } = RATE_LIMIT_DEFINITIONS[name];
    const rule = parseRateLimitRule(present[variable] ?? defaultRule);
    if (!rule) throw new ConfigValidationError([`${variable} is not a valid rate limit`]);
    return [name, rule];
  });
  return Object.fromEntries(entries) as Record<RateLimitName, RateLimitRule>;
}

function describeProblem(error: ValidationError): string {
  const constraints = error.constraints ?? {};
  // A missing variable fails every rule; "is required" is the only useful message then.
  const messages = constraints.isDefined ? [constraints.isDefined] : Object.values(constraints);
  return `${error.property} ${messages.join('; ')}`;
}
