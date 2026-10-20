import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Knex } from 'knex';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { KNEX } from '../../src/common/database/database.constants';
import { resetDatabase } from './database';
import { buildTestConfig } from './test-config';
import type { TestApp, TestAppOptions } from './types';

/**
 * Boots the real app (every module, the global pipe and filter, `configureApp()`) against the
 * test database, for supertest. Nothing is mocked. Data is truncated on start and on `close()`.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const config = options.config ?? buildTestConfig();
  const resetData = options.resetData ?? true;

  const moduleRef = await Test.createTestingModule({
    imports: [
      AppModule.forRoot({
        config,
        ...(options.logDestination ? { logDestination: options.logDestination } : {}),
      }),
      ...(options.imports ?? []),
    ],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app, config);
  await app.init();

  const knex = app.get<Knex>(KNEX);
  const { schema } = config.database;
  if (resetData) await resetDatabase(knex, schema);

  return {
    app,
    config,
    knex,
    http: () => request(app.getHttpServer()),
    close: async () => {
      try {
        if (resetData) await resetDatabase(knex, schema);
      } finally {
        await app.close();
      }
    },
  };
}
