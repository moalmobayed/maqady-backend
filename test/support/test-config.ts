import { loadDotenv } from '../../src/common/config/dotenv';
import { loadConfig } from '../../src/common/config/load-config';
import type { AppConfig } from '../../src/common/config/types';

// A developer can point the suite elsewhere with TEST_DATABASE_URL in .env.
loadDotenv();

export const DEFAULT_TEST_DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/maqady_test';
export const TEST_SCHEMA = 'maqady';
export const TEST_CORS_ORIGIN = 'http://localhost:5173';

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

/** A real, validated config for the test app: the test database and silent logs. */
export function buildTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const config = loadConfig({
    DATABASE_URL: testDatabaseUrl(),
    DB_SCHEMA: TEST_SCHEMA,
    CORS_ORIGINS: TEST_CORS_ORIGIN,
    LOG_LEVEL: 'silent',
  });
  return { ...config, ...overrides };
}
