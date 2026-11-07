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
import type { SettleFirstOptions, SettlementScope } from './types';

const SHOWTIME_ID_PARAM = /^[1-9][0-9]{0,15}$/;

/**
 * Runs `SettlementService.settleDue()` before a route marked `@SettleFirst()` (design §7.1
 * step 1). It is registered between `OutboxDrainInterceptor` and `WriteInterceptor`, so it runs
 * after the guards (the caller is known) and before the request transaction opens: settlement
 * commits in its own transaction first, and the request then takes its own locks in order.
 *
 * The scope is the path's booking reference or showtime id (or the body's typed `reference` or
 * `showtimeId`, U13), plus the calling customer, or for `'customer'` only the calling customer
 * (anyone else settles nothing). Pipes have not run yet, so a malformed parameter settles nothing
 * and the route's validation answers it. Other routes, and contexts other than HTTP, pass
 * straight through. A settlement error fails
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
    const options = this.reflector.get<SettleFirstOptions | undefined>(
      SETTLE_FIRST_METADATA,
      context.getHandler(),
    );
    if (options === undefined) return next.handle();
    const scope = scopeOf(options, context.switchToHttp().getRequest<Request>());
    if (!scope) return next.handle();
    return defer(() => this.settlement.settleDue(scope)).pipe(switchMap(() => next.handle()));
  }
}

/** The settlement scope of a request; undefined when its parameter is malformed or missing. */
export function scopeOf(
  { kind, source }: SettleFirstOptions,
  request: Request,
): SettlementScope | undefined {
  const customer =
    request.principal?.kind === 'customer' ? { customerId: request.principal.id } : {};
  // My Bookings (U12): only the calling customer's bookings; anyone else settles nothing.
  if (kind === 'customer') return 'customerId' in customer ? customer : undefined;
  if (kind === 'booking') {
    const ref = source === 'body' ? bodyReference(request) : request.params?.ref;
    return typeof ref === 'string' && REFERENCE_PATTERN.test(ref)
      ? { bookingReference: ref, ...customer }
      : undefined;
  }
  const showtimeId = source === 'body' ? bodyShowtimeId(request) : paramShowtimeId(request);
  return showtimeId === undefined ? undefined : { showtimeId, ...customer };
}

function paramShowtimeId(request: Request): number | undefined {
  const id = request.params?.id;
  const showtimeId = typeof id === 'string' && SHOWTIME_ID_PARAM.test(id) ? Number(id) : NaN;
  return Number.isSafeInteger(showtimeId) ? showtimeId : undefined;
}

/**
 * The raw JSON body's typed `reference` (`POST /admin/scans`, U13), as validation normalises it:
 * trimmed and upper-cased. Anything else settles nothing.
 */
function bodyReference(request: Request): string | undefined {
  const body: unknown = request.body;
  if (typeof body !== 'object' || body === null) return undefined;
  const value = (body as Record<string, unknown>).reference;
  return typeof value === 'string' ? value.trim().toUpperCase() : undefined;
}

/** The raw JSON body's `showtimeId`: a positive safe integer, or nothing to settle. */
function bodyShowtimeId(request: Request): number | undefined {
  const body: unknown = request.body;
  if (typeof body !== 'object' || body === null) return undefined;
  const value = (body as Record<string, unknown>).showtimeId;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
