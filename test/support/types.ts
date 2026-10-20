import type { ModuleMetadata } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Knex } from 'knex';
import type { DestinationStream } from 'pino';
import type request from 'supertest';
import type { AppConfig } from '../../src/common/config/types';

export interface TestAppOptions {
  /** Defaults to `buildTestConfig()`: the test database, silent logs. */
  readonly config?: AppConfig;
  /** Extra modules, such as the test-only probe routes. */
  readonly imports?: ModuleMetadata['imports'];
  /** Capture log lines instead of discarding them. */
  readonly logDestination?: DestinationStream;
  /** Truncate data on start and close (default true). Off for an app with no database. */
  readonly resetData?: boolean;
}

export interface TestApp {
  readonly app: NestExpressApplication;
  readonly config: AppConfig;
  readonly knex: Knex;
  /** A supertest agent bound to the app's HTTP server. */
  readonly http: () => ReturnType<typeof request>;
  /** Truncates the data the suite wrote, then closes the app. Call it in `afterAll`. */
  readonly close: () => Promise<void>;
}

export interface LogCapture {
  readonly stream: DestinationStream;
  /** Every line written so far, parsed. */
  readonly entries: () => Record<string, unknown>[];
  /** Every line written so far, as raw text. */
  readonly text: () => string;
}
