import type { ModuleMetadata } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Knex } from 'knex';
import type { DestinationStream } from 'pino';
import type request from 'supertest';
import type { Principal } from '../../src/common/auth/types';
import type { AppConfig } from '../../src/common/config/types';
import type { AppError } from '../../src/common/errors/app-error';
import type { Clock } from '../../src/common/time/clock';
import type { OutgoingEmail, SendOutcome } from '../../src/modules/messaging/types';

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
  /**
   * Replaces providers by token, for genuinely external services only (the email sender at its
   * adapter boundary). Never a service, repository or datastore of ours.
   */
  readonly overrides?: readonly ProviderOverride[];
}

/** One provider replaced in the test app. */
export interface ProviderOverride {
  readonly provide: abstract new (...args: never[]) => unknown;
  readonly useValue: unknown;
}

/** How `RecordingEmailSender` answers one email. */
export type EmailResponder = (email: OutgoingEmail) => SendOutcome;

/** The parameters of the test template `test.one_time_link`. */
export interface OneTimeLinkParams {
  readonly name: string;
  readonly token: string;
}

/** The parameters of the test template `test.sms_notice`. */
export interface SmsNoticeParams {
  readonly text: string;
}

/** A `messages` row as the integration tests read it back. */
export interface StoredMessage {
  readonly id: number;
  readonly channel: string;
  readonly template: string;
  readonly recipient: string;
  readonly subject: string | null;
  readonly body_text: string;
  readonly body_html: string | null;
  readonly status: string;
  readonly attempts: number;
  readonly last_error_code: string | null;
  readonly next_attempt_at: Date | null;
  readonly payload_ciphertext: string | null;
  readonly provider_message_id: string | null;
  readonly sent_at: Date | null;
  readonly related_customer_id: number | null;
  readonly related_staff_user_id: number | null;
  readonly related_booking_id: number | null;
  readonly created_at: Date;
  readonly updated_at: Date;
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
