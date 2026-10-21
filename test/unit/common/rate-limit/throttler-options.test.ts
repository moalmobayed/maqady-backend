import { Reflector } from '@nestjs/core';
import type { ThrottlerOptions } from '@nestjs/throttler';
import { RATE_LIMIT_NAMES } from '../../../../src/common/rate-limit/enums';
import { RATE_LIMIT_DEFINITIONS } from '../../../../src/common/rate-limit/rate-limit.constants';
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

  it('counts resend-verification requests per signed-in customer (U9)', () => {
    const resend = throttlers.find((throttler) => throttler.name === 'verificationResendCustomer')!;
    const tracker = resend.getTracker as (request: Record<string, unknown>) => string;
    const asCustomer = (id: number) => ({ ip: '203.0.113.9', principal: { kind: 'customer', id } });
    expect(tracker(asCustomer(5))).toBe('customer:5');
    expect(tracker(asCustomer(6))).toBe('customer:6');
    expect(RATE_LIMIT_DEFINITIONS.verificationResendCustomer).toEqual({
      defaultRule: '3/1h',
      key: 'customer',
      variable: 'RATE_LIMIT_VERIFICATION_RESEND_CUSTOMER',
    });
  });
});
