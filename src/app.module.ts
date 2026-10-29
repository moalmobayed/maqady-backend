import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import type { AppModuleOptions } from './app.types';
import { AuditModule } from './common/audit/audit.module';
import { AccessGuard } from './common/auth/access.guard';
import { AuthModule } from './common/auth/auth.module';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { AppConfigModule } from './common/config/app-config.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { DatabaseModule } from './common/database/database.module';
import { GlobalExceptionFilter } from './common/errors/global-exception.filter';
import { createValidationPipe } from './common/errors/validation';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { WriteInterceptor } from './common/idempotency/write.interceptor';
import { LoggingModule } from './common/logging/logging.module';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { TimeModule } from './common/time/time.module';
import { AdminCustomersModule } from './modules/admin-customers/admin-customers.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { SettleFirstInterceptor } from './modules/bookings/settle-first.interceptor';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CustomersModule } from './modules/customers/customers.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { HallsModule } from './modules/halls/halls.module';
import { HealthModule } from './modules/health/health.module';
import { MediaModule } from './modules/media/media.module';
import { MessageLogModule } from './modules/messaging/message-log.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { OutboxDrainInterceptor } from './modules/messaging/outbox-drain.interceptor';
import { PaymentsModule } from './modules/payments/payments.module';
import { SeatingModule } from './modules/seating/seating.module';
import { ShowtimesModule } from './modules/showtimes/showtimes.module';
import { StaffModule } from './modules/staff/staff.module';
import { TheatersModule } from './modules/theaters/theaters.module';

/**
 * The root module. It takes the validated configuration as a value, so `main.ts`, the CLIs and
 * the tests each decide where the configuration comes from.
 *
 * Global enhancers live here, and their order matters:
 *
 * - the one `ValidationPipe` and the one exception filter;
 * - the guards, in the order of design §10.3: `JwtAuthGuard` (who is calling), `RateLimitGuard`
 *   (so per-customer limits know the customer), then `AccessGuard` (may they call this route);
 * - the interceptors, outermost first: `OutboxDrainInterceptor`, which starts sending queued
 *   messages once a write has committed (§13.1); `SettleFirstInterceptor`, which settles due
 *   payments in their own transaction before a `@SettleFirst()` route's own (§7.1 step 1, U11);
 *   then the `WriteInterceptor`, which runs every write in one transaction with idempotency
 *   (§14.1).
 *
 * Feature modules are imported in the order of the delivery plan (design §21).
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
        TimeModule,
        CryptoModule,
        AuditModule,
        AuthModule,
        RateLimitModule,
        IdempotencyModule,
        MessagingModule,
        HealthModule,
        StaffModule,
        MediaModule,
        TheatersModule,
        MessageLogModule,
        CustomersModule,
        CatalogModule,
        HallsModule,
        DiscoveryModule,
        ShowtimesModule,
        SeatingModule,
        PaymentsModule,
        BookingsModule,
        AdminCustomersModule,
        AnalyticsModule,
      ],
      providers: [
        { provide: APP_PIPE, useFactory: createValidationPipe },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        { provide: APP_GUARD, useExisting: JwtAuthGuard },
        { provide: APP_GUARD, useExisting: RateLimitGuard },
        { provide: APP_GUARD, useExisting: AccessGuard },
        { provide: APP_INTERCEPTOR, useExisting: OutboxDrainInterceptor },
        { provide: APP_INTERCEPTOR, useExisting: SettleFirstInterceptor },
        { provide: APP_INTERCEPTOR, useExisting: WriteInterceptor },
      ],
    };
  }
}
