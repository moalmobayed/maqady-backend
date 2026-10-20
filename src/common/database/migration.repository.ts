import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Knex } from 'knex';
import { APP_CONFIG } from '../config/config.constants';
import type { AppConfig } from '../config/types';
import { KNEX, MIGRATIONS_DIRECTORY, MIGRATIONS_TABLE } from './database.constants';
import { DirectoryMigrationSource } from './migration-source';
import type { MigrationResult } from './types';

/**
 * Runs the migrations in `src/migrations`. `main.ts` calls it before the server listens, and
 * `npm run migrate` calls it from the command line. Knex's migration lock makes concurrent
 * runs (an old and a new release starting side by side) safe.
 */
@Injectable()
export class MigrationRepository {
  private readonly logger = new Logger(MigrationRepository.name);

  constructor(
    @Inject(KNEX) private readonly knex: Knex,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async migrateLatest(): Promise<MigrationResult> {
    const { schema } = this.config.database;

    // Knex keeps its bookkeeping tables in the schema, so it must exist before Knex looks.
    await this.knex.raw('CREATE SCHEMA IF NOT EXISTS ??', [schema]);

    const [batch, applied] = (await this.knex.migrate.latest({
      migrationSource: new DirectoryMigrationSource(MIGRATIONS_DIRECTORY, { schema }),
      schemaName: schema,
      tableName: MIGRATIONS_TABLE,
    })) as [number, string[]];

    if (applied.length === 0) {
      this.logger.log('Database schema is up to date');
    }
    for (const name of applied) {
      this.logger.log(`Applied migration ${name}`);
    }
    return { batch, applied };
  }
}
