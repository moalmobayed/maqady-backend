import type { ModuleMetadata } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Knex } from 'knex';
import type { DestinationStream } from 'pino';
import type request from 'supertest';
import type { AccessLevel, Principal, StaffRole } from '../../src/common/auth/types';
import type { AppConfig } from '../../src/common/config/types';
import type { AppError } from '../../src/common/errors/app-error';
import type { Clock } from '../../src/common/time/clock';

export interface TestAppOptions {
  /** Defaults to `buildTestConfig()`: the test database, silent logs. */
  readonly config?: AppConfig;
  /** Extra modules, such as the test-only probe routes. */
  readonly imports?: ModuleMetadata['imports'];
  /** Capture log lines instead of discarding them. */
  readonly logDestination?: DestinationStream;
  /** Truncate data on start and close (default true). Off for an app with no database. */
  readonly resetData?: boolean;
  /** Replaces the app's `Clock`, for tests that move time. */
  readonly clock?: Clock;
  /** Providers replaced by a value, such as `REAL_RESOLVERS_OFF`. */
  readonly overrides?: readonly ProviderOverride[];
}

/** One provider of the app replaced by a value in a test app. */
export interface ProviderOverride {
  readonly provide: unknown;
  readonly useValue: unknown;
}

/** A staff member `createStaffMember()` made, with the password it set. */
export interface CreatedStaffMember {
  readonly id: number;
  readonly email: string;
  readonly password: string;
  readonly role: StaffRole;
}

/** What `createStaffMember()` takes; everything but the role has a unique default. */
export interface StaffMemberFixture {
  readonly role: StaffRole;
  readonly email?: string;
  readonly fullName?: string;
  readonly password?: string;
}

/** A signed-in staff member: real tokens from the real sign-in. */
export interface StaffSession {
  readonly staffUserId: number;
  readonly sessionId: number;
  readonly email: string;
  readonly password: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  /** `Bearer <accessToken>`, for `.set('Authorization', …)`. */
  readonly authorization: string;
}

/** One HTTP route of the app, as the Nest router knows it. */
export interface HttpRoute {
  /** `GET`, `POST`, … */
  readonly method: string;
  /** With the global prefix and `:param` placeholders: `/api/v1/admin/staff/:id`. */
  readonly path: string;
  readonly access: AccessLevel | undefined;
  /** `StaffController.listStaff`. */
  readonly handler: string;
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

/** What a test principal resolver answers for one session: a principal, gone, or an error. */
export type ResolverEntry = Principal | AppError | null;

/** What `fakeContext()` builds a unit-test `ExecutionContext` from. */
export interface FakeContextOptions {
  readonly type?: 'http' | 'ws' | 'rpc';
  readonly request?: object;
  readonly response?: object;
  readonly handler?: (...args: never[]) => unknown;
  readonly controller?: abstract new (...args: never[]) => unknown;
}
