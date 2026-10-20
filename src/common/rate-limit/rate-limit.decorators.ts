import { SetMetadata } from '@nestjs/common';
import { RATE_LIMITS_METADATA } from './rate-limit.constants';
import type { NamedRateLimit } from './types';

/**
 * Opts a route into named limits of design §10.6, on top of the `default` limit every route has.
 *
 * @example @RateLimit('signInEmail', 'signInIp')
 */
export const RateLimit = (...limits: NamedRateLimit[]): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMITS_METADATA, limits);
