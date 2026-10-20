import type { IncomingMessage } from 'node:http';
import type { DestinationStream } from 'pino';
import type { LogLevel } from '../config/types';

export interface LoggingOptions {
  readonly level: LogLevel;
  /** Where log lines go; stdout when omitted. Tests pass a stream so they can read the lines. */
  readonly destination?: DestinationStream;
}

/** An error as written to the logs. A Postgres error keeps only its SQLSTATE and constraint. */
export interface SerializedError {
  readonly type: string;
  readonly message?: string;
  readonly code?: string;
  readonly constraint?: string;
  readonly stack?: string;
  readonly cause?: SerializedError;
}

/** The one line logged per request (design §14.4). Auth units add the principal kind and id. */
export interface RequestLogLine {
  readonly method: string | undefined;
  /** The matched route template, such as `/api/v1/health/ready`; null when no route matched. */
  readonly route: string | null;
  readonly statusCode: number;
  readonly responseTime: number;
}

/** A request after Express routing: `route.path` is the matched template. */
export type RoutedRequest = IncomingMessage & {
  readonly route?: { readonly path?: unknown };
  readonly baseUrl?: unknown;
};
