import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { defer, type Observable, switchMap } from 'rxjs';
import { REFERENCE_PATTERN, SETTLE_FIRST_METADATA } from './bookings.constants';
import { SettlementService } from './settlement.service';
import type { SettleFirstKind, SettlementScope } from './types';

/**
 * Runs `SettlementService.settleDue()` before a route marked `@SettleFirst()` (design §7.1
 * step 1). It is registered between `OutboxDrainInterceptor` and `WriteInterceptor`, so it runs
 * after the guards (the caller is known) and before the request transaction opens: settlement
 * commits in its own transaction first, and the request then takes its own locks in order.
 *
 * The scope is the path's booking reference or showtime id, plus the calling customer. Pipes
 * have not run yet, so a malformed parameter settles nothing and the route's validation answers
 * it. Other routes, and contexts other than HTTP, pass straight through. A settlement error fails
 * the request (`SERVICE_UNAVAILABLE` when the database is down).
 */
@Injectable()
export class SettleFirstInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly settlement: SettlementService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const kind = this.reflector.get<SettleFirstKind | undefined>(
      SETTLE_FIRST_METADATA,
      context.getHandler(),
    );
    if (kind === undefined) return next.handle();
    const scope = scopeOf(kind, context.switchToHttp().getRequest<Request>());
    if (!scope) return next.handle();
    return defer(() => this.settlement.settleDue(scope)).pipe(switchMap(() => next.handle()));
  }
}

/** The settlement scope of a request; undefined when its path parameter is malformed. */
export function scopeOf(kind: SettleFirstKind, request: Request): SettlementScope | undefined {
  const customer =
    request.principal?.kind === 'customer' ? { customerId: request.principal.id } : {};
  if (kind === 'booking') {
    const ref = request.params?.ref;
    return typeof ref === 'string' && REFERENCE_PATTERN.test(ref)
      ? { bookingReference: ref, ...customer }
      : undefined;
  }
  const id = request.params?.id;
  const showtimeId = typeof id === 'string' && /^[1-9][0-9]{0,15}$/.test(id) ? Number(id) : NaN;
  return Number.isSafeInteger(showtimeId) ? { showtimeId, ...customer } : undefined;
}
