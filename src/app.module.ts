import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import type { AppModuleOptions } from './app.types';
import { AppConfigModule } from './common/config/app-config.module';
import { DatabaseModule } from './common/database/database.module';
import { GlobalExceptionFilter } from './common/errors/global-exception.filter';
import { createValidationPipe } from './common/errors/validation';
import { LoggingModule } from './common/logging/logging.module';
import { HealthModule } from './modules/health/health.module';

/**
 * The root module. It takes the validated configuration as a value, so `main.ts`, the CLIs and
 * the tests each decide where the configuration comes from.
 *
 * Global enhancers live here: the one `ValidationPipe` and the one exception filter. Feature
 * modules are imported in the order of the delivery plan (design §21).
 */
@Module({})
export class AppModule {
  static forRoot({ config, logDestination }: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        LoggingModule.forRoot({
          level: config.logLevel,
          ...(logDestination ? { destination: logDestination } : {}),
        }),
        DatabaseModule,
        HealthModule,
      ],
      providers: [
        { provide: APP_PIPE, useFactory: createValidationPipe },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
      ],
    };
  }
}
