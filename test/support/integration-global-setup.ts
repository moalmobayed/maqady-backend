import { Logger } from '@nestjs/common';
import { loadDotenv } from '../../src/common/config/dotenv';
import { createKnex } from '../../src/common/database/knex.factory';
import { MigrationRepository } from '../../src/common/database/migration.repository';
import { buildTestConfig } from './test-config';

/**
 * Runs once before the integration suites: drops the schema and the extensions, then migrates
 * from zero with the same code the service runs at boot (design §15).
 */
export default async function integrationGlobalSetup(): Promise<void> {
  loadDotenv();
  const config = buildTestConfig();
  const knex = createKnex(config.database);
  try {
    await knex.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [config.database.schema]);
    await knex.raw('DROP EXTENSION IF EXISTS citext, pg_trgm, btree_gist CASCADE');
    Logger.overrideLogger(false);
    await new MigrationRepository(knex, config).migrateLatest();
  } finally {
    await knex.destroy();
  }
}
