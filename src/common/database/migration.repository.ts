import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Knex } from 'knex';
import { APP_CONFIG } from '../config/config.constants';
import type { AppConfig } from '../config/types';
import {
  KNEX,
  MIGRATION_ADVISORY_LOCK,
  MIGRATION_LOCK_HOLDER_IDLE_TIMEOUT,
  MIGRATION_LOCK_TIMEOUT,
  MIGRATIONS_TABLE,
} from './database.constants';
import { MIGRATIONS } from './migration-list';
import { ListedMigrationSource } from './migration-source';
import type { MigrationResult } from './types';

/**
 * Runs the migrations in `src/migrations`. `main.ts` calls it before the server listens, and
 * `npm run migrate` calls it from the command line.
 *
 * Concurrent runs (instances booting side by side, or `npm run migrate` during a boot) wait
 * for each other on a transaction-scoped advisory lock, held on its own pooled connection for
 * the whole run. Knex's migration lock alone is not enough: the schema and Knex's tables are
 * created before it is taken, so concurrent first runs fail on duplicate catalog entries.
 * The lock is released when the holding transaction ends, or when its connection drops.
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

    const [batch, applied] = await this.knex.transaction(async (lock) => {
      // A waiter may wait for a whole run, but no longer than MIGRATION_LOCK_TIMEOUT; the holder
      // sits idle while the migrations run on other connections, for at most
      // MIGRATION_LOCK_HOLDER_IDLE_TIMEOUT, so a holder whose process died frees the lock.
      await lock.raw("SET LOCAL statement_timeout = '0'");
      await lock.raw(`SET LOCAL lock_timeout = '${MIGRATION_LOCK_TIMEOUT}'`);
      await lock.raw(
        `SET LOCAL idle_in_transaction_session_timeout = '${MIGRATION_LOCK_HOLDER_IDLE_TIMEOUT}'`,
      );
      await lock.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [MIGRATION_ADVISORY_LOCK]);

      // Knex keeps its bookkeeping tables in the schema, so it must exist before Knex looks.
      await this.knex.raw('CREATE SCHEMA IF NOT EXISTS ??', [schema]);

      return (await this.knex.migrate.latest({
        migrationSource: new ListedMigrationSource(MIGRATIONS, { schema }),
        schemaName: schema,
        tableName: MIGRATIONS_TABLE,
      })) as [number, string[]];
    });

    if (applied.length === 0) {
      this.logger.log('Database schema is up to date');
    }
    for (const name of applied) {
      this.logger.log(`Applied migration ${name}`);
    }
    return { batch, applied };
  }
}
