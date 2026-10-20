import { Reflector } from '@nestjs/core';
import type { ThrottlerOptions } from '@nestjs/throttler';
import { RATE_LIMIT_NAMES } from '../../../../src/common/rate-limit/enums';
import { buildThrottlerOptions } from '../../../../src/common/rate-limit/throttler-options';
import type { RateLimitsConfig } from '../../../../src/common/rate-limit/types';

describe('buildThrottlerOptions', () => {
  const limits = Object.fromEntries(
    RATE_LIMIT_NAMES.map((name, index) => [name, { limit: index + 1, windowSeconds: 60 }]),
  ) as unknown as RateLimitsConfig;
  const { throttlers } = buildThrottlerOptions(limits, new Reflector()) as {
    throttlers: ThrottlerOptions[];
  };

  it('defines one throttler per named limit of design 10.6, with ttl in milliseconds', () => {
    expect(throttlers.map((throttler) => throttler.name)).toEqual([...RATE_LIMIT_NAMES]);
    expect(throttlers[0]).toMatchObject({ name: 'default', limit: 1, ttl: 60_000 });
  });

  it('applies the default limit everywhere, counted per route by the throttler', () => {
    const defaults = throttlers[0]!;
    expect(defaults.skipIf).toBeUndefined();
    expect(defaults.generateKey).toBeUndefined();
  });

  it('shares a named limit across routes: its key ignores the route', () => {
    const search = throttlers.find((throttler) => throttler.name === 'search')!;
    const generateKey = search.generateKey as (
      context: unknown,
      tracker: string,
      name: string,
    ) => string;
    expect(generateKey({}, 'ip:1.2.3.4', 'search')).toBe(
      generateKey({ other: 1 }, 'ip:1.2.3.4', 'search'),
    );
    expect(generateKey({}, 'ip:1.2.3.4', 'search')).not.toBe(
      generateKey({}, 'ip:1.2.3.5', 'search'),
    );
    expect(search.skipIf).toEqual(expect.any(Function));
  });
});
