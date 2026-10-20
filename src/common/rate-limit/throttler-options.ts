import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { ThrottlerModuleOptions, ThrottlerOptions } from '@nestjs/throttler';
import type { Request } from 'express';
import { sha256Hex } from '../crypto/hashing';
import { RATE_LIMIT_NAMES } from './enums';
import { RATE_LIMIT_DEFINITIONS } from './rate-limit.constants';
import { shouldSkipLimit, trackerFor } from './trackers';
import type { NamedRateLimit, RateLimitsConfig } from './types';

const MILLISECONDS_PER_SECOND = 1000;

/**
 * The throttler configuration for every limit of design §10.6, with in-memory storage.
 *
 * - `default` applies to every route and counts per route.
 * - Named limits apply only where `@RateLimit(...)` declares them, and share one bucket across
 *   the routes that declare them.
 */
export function buildThrottlerOptions(
  limits: RateLimitsConfig,
  reflector: Reflector,
): ThrottlerModuleOptions {
  const throttlers = RATE_LIMIT_NAMES.map((name): ThrottlerOptions => {
    const { key } = RATE_LIMIT_DEFINITIONS[name];
    const rule = limits[name];
    const base: ThrottlerOptions = {
      name,
      limit: rule.limit,
      ttl: rule.windowSeconds * MILLISECONDS_PER_SECOND,
      getTracker: (request: Record<string, unknown>) =>
        trackerFor(key, request as unknown as Request),
    };
    if (name === 'default') return base;
    const named: NamedRateLimit = name;
    return {
      ...base,
      skipIf: (context: ExecutionContext) => shouldSkipLimit(named, key, reflector, context),
      generateKey: (_context: ExecutionContext, tracker: string, throttler: string) =>
        sha256Hex(`${throttler}|${tracker}`),
    };
  });
  return { throttlers };
}
