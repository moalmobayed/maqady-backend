import { type DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { buildLoggerParams } from './logger.params';
import type { LoggingOptions } from './types';

/** Structured JSON logs through nestjs-pino (design §14.4). Inject `PinoLogger` or use Nest's `Logger`. */
@Module({})
export class LoggingModule {
  static forRoot(options: LoggingOptions): DynamicModule {
    return {
      module: LoggingModule,
      imports: [LoggerModule.forRoot(buildLoggerParams(options))],
      exports: [LoggerModule],
    };
  }
}
