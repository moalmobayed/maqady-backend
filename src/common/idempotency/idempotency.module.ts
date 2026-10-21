import { Module } from '@nestjs/common';
import { IdempotencyRepository } from './idempotency.repository';
import { IdempotencyService } from './idempotency.service';
import { WriteInterceptor } from './write.interceptor';

/**
 * Idempotency keys and the write interceptor (design §14.1). `AppModule` registers
 * `WriteInterceptor` as the global `APP_INTERCEPTOR`.
 */
@Module({
  providers: [IdempotencyRepository, IdempotencyService, WriteInterceptor],
  exports: [IdempotencyService, WriteInterceptor],
})
export class IdempotencyModule {}
