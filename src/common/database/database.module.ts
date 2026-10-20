import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Knex } from 'knex';
import { APP_CONFIG } from '../config/config.constants';
import type { AppConfig } from '../config/types';
import { KNEX } from './database.constants';
import { createKnex } from './knex.factory';
import { MigrationRepository } from './migration.repository';
import { TransactionContext } from './transaction-context';
import { TransactionRepository } from './transaction.repository';

/**
 * The single shared Knex provider (CLAUDE.md "Database"). Creating it opens no connection; the
 * pool connects on the first query, so the app (and `npm run contract`) can start without a
 * database. Repositories take their executor from `TransactionContext`, and transactions open
 * only through `TransactionRepository`.
 */
@Global()
@Module({
  providers: [
    {
      provide: KNEX,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Knex => createKnex(config.database),
    },
    MigrationRepository,
    TransactionContext,
    TransactionRepository,
  ],
  exports: [KNEX, MigrationRepository, TransactionContext, TransactionRepository],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(KNEX) private readonly knex: Knex) {}

  async onApplicationShutdown(): Promise<void> {
    await this.knex.destroy();
  }
}
