import { Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_CONFIG } from '../config/config.constants';
import type { AppConfig } from '../config/types';
import { RateLimitGuard } from './rate-limit.guard';
import { buildThrottlerOptions } from './throttler-options';

/**
 * Rate limiting with in-memory counters (ADR 0003: one instance). `AppModule` registers
 * `RateLimitGuard` as the second `APP_GUARD`.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG, Reflector],
      useFactory: (config: AppConfig, reflector: Reflector) =>
        buildThrottlerOptions(config.rateLimits, reflector),
    }),
  ],
  providers: [RateLimitGuard],
  exports: [ThrottlerModule, RateLimitGuard],
})
export class RateLimitModule {}
