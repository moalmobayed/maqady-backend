import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * The second global guard (design §10.3, §10.6): @nestjs/throttler, after `JwtAuthGuard` so a
 * per-customer limit knows the customer. A `429` becomes `RATE_LIMITED` with `Retry-After` in the
 * global filter. Non-HTTP contexts pass through; the gateway enforces its own limits (U10).
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected override shouldSkip(context: ExecutionContext): Promise<boolean> {
    return Promise.resolve(context.getType() !== 'http');
  }
}
