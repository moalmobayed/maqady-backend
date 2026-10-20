import { loadDotenv } from '../../src/common/config/dotenv';
import { loadConfig } from '../../src/common/config/load-config';
import type { AppConfig } from '../../src/common/config/types';
import { RATE_LIMIT_NAMES } from '../../src/common/rate-limit/enums';
import { RATE_LIMIT_DEFINITIONS } from '../../src/common/rate-limit/rate-limit.constants';

// A developer can point the suite elsewhere with TEST_DATABASE_URL in .env.
loadDotenv();

export const DEFAULT_TEST_DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/maqady_test';
export const TEST_SCHEMA = 'maqady';
export const TEST_CORS_ORIGIN = 'http://localhost:5173';

/** Fixed test secrets (base64 of 32 distinct bytes each); never used outside the suite. */
export const TEST_CUSTOMER_TOKEN_SECRET = Buffer.alloc(32, 0x11).toString('base64');
export const TEST_STAFF_TOKEN_SECRET = Buffer.alloc(32, 0x22).toString('base64');
export const TEST_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 0x33).toString('base64');

/** Design §15: limits are raised in tests, so concurrency tests aren't throttled. */
export const TEST_RATE_LIMIT_RULE = '100000/1m';

/** The environment variables of a valid test configuration, for tests that tweak one. */
export function testEnvironment(): Record<string, string> {
  const rateLimits = Object.fromEntries(
    RATE_LIMIT_NAMES.map((name) => [RATE_LIMIT_DEFINITIONS[name].variable, TEST_RATE_LIMIT_RULE]),
  );
  return {
    DATABASE_URL: testDatabaseUrl(),
    DB_SCHEMA: TEST_SCHEMA,
    CORS_ORIGINS: TEST_CORS_ORIGIN,
    LOG_LEVEL: 'silent',
    JWT_SECRET_CUSTOMER: TEST_CUSTOMER_TOKEN_SECRET,
    JWT_SECRET_STAFF: TEST_STAFF_TOKEN_SECRET,
    DATA_ENCRYPTION_KEY: TEST_DATA_ENCRYPTION_KEY,
    ...rateLimits,
  };
}

/**
 * The integration database: `TEST_DATABASE_URL`, or the local default. The suite drops and
 * re-creates the schema, so it refuses any database whose name doesn't end in `_test`.
 */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL?.trim() || DEFAULT_TEST_DATABASE_URL;
  const database = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!database.endsWith('_test')) {
    throw new Error(
      `Refusing to run integration tests against "${database}": the database name must end in _test`,
    );
  }
  return url;
}

/**
 * A real, validated config for the test app: the test database, silent logs, the test secrets
 * and raised rate limits. `environment` overrides individual variables.
 */
export function buildTestConfig(
  overrides: Partial<AppConfig> = {},
  environment: Record<string, string> = {},
): AppConfig {
  const config = loadConfig({ ...testEnvironment(), ...environment });
  return { ...config, ...overrides };
}
