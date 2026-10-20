import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { type Observable, tap } from 'rxjs';
import { WRITE_METHODS } from '../../common/idempotency/idempotency.constants';
import { DRAIN_AFTER_RESPONSE_METADATA } from './messaging.constants';
import { OutboxDrainService } from './outbox-drain.service';

/**
 * The opportunistic drain trigger (design §13.1). After a write request's handler succeeds, and
 * so after `WriteInterceptor` (registered after this one, so it runs inside it) has committed,
 * it asks for one `batch` drain; a handler marked `@DrainOutboxAfterResponse()` asks for a
 * `flush`. A failed request asks for nothing. Contexts other than HTTP pass straight through.
 */
@Injectable()
export class OutboxDrainInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly drain: OutboxDrainService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const flush =
      this.reflector.get<boolean | undefined>(
        DRAIN_AFTER_RESPONSE_METADATA,
        context.getHandler(),
      ) === true;
    const { method } = context.switchToHttp().getRequest<Request>();
    if (!flush && !WRITE_METHODS.has(method)) return next.handle();
    return next
      .handle()
      .pipe(tap({ complete: () => this.drain.requestDrain(flush ? 'flush' : 'batch') }));
  }
}
