import type { DestinationStream } from 'pino';
import type { AppConfig } from './common/config/types';

export interface AppModuleOptions {
  /** The configuration validated before the app is created. */
  readonly config: AppConfig;
  /** Where log lines go; stdout when omitted. Tests pass a stream to read them. */
  readonly logDestination?: DestinationStream;
}
