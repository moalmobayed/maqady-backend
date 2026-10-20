import { plainToInstance } from 'class-transformer';
import { type ValidationError, validateSync } from 'class-validator';
import { EnvironmentVariables } from './environment-variables';
import type { AppConfig, LogLevel } from './types';
import { splitList } from './validators';

export const DEFAULT_PORT = 3000;
export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

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
  if (errors.length > 0) {
    throw new ConfigValidationError(errors.map(describeProblem));
  }

  return {
    port: variables.PORT ?? DEFAULT_PORT,
    logLevel: variables.LOG_LEVEL ?? DEFAULT_LOG_LEVEL,
    corsOrigins: splitList(variables.CORS_ORIGINS),
    database: { url: variables.DATABASE_URL, schema: variables.DB_SCHEMA },
  };
}

function describeProblem(error: ValidationError): string {
  const constraints = error.constraints ?? {};
  // A missing variable fails every rule; "is required" is the only useful message then.
  const messages = constraints.isDefined ? [constraints.isDefined] : Object.values(constraints);
  return `${error.property} ${messages.join('; ')}`;
}
