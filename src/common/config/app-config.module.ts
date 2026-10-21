import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_CONFIG } from './config.constants';
import type { AppConfig } from './types';

/**
 * Provides the configuration that `main.ts` (or a test) validated before the app was created,
 * so a bad environment stops the process before Nest starts.
 */
@Global()
@Module({})
export class AppConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
