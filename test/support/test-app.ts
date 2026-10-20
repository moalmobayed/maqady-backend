import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Knex } from 'knex';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { KNEX } from '../../src/common/database/database.constants';
import { Clock } from '../../src/common/time/clock';
import { resetDatabase } from './database';
import { buildTestConfig } from './test-config';
import type { TestApp, TestAppOptions } from './types';

/**
 * Boots the real app (every module, the global pipe, filter, guards and interceptor,
 * `configureApp()`) against the test database, for supertest. Nothing is mocked; only the
 * `Clock` can be replaced, so a test can move time. Data is truncated on start and on `close()`.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const config = options.config ?? buildTestConfig();
  const resetData = options.resetData ?? true;

  const builder = Test.createTestingModule({
    imports: [
      AppModule.forRoot({
        config,
        ...(options.logDestination ? { logDestination: options.logDestination } : {}),
      }),
      ...(options.imports ?? []),
    ],
  });
  if (options.clock) builder.overrideProvider(Clock).useValue(options.clock);
  const moduleRef = await builder.compile();

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
