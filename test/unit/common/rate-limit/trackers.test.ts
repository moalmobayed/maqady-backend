import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { sha256Hex } from '../../../../src/common/crypto/hashing';
import { RateLimit } from '../../../../src/common/rate-limit/rate-limit.decorators';
import { parseRateLimitRule } from '../../../../src/common/rate-limit/rate-limit.constants';
import { shouldSkipLimit, trackerFor } from '../../../../src/common/rate-limit/trackers';
import { fakeContext } from '../../../support/execution-context';

const request = (fields: Record<string, unknown>): Request =>
  ({ ip: '203.0.113.9', params: {}, ...fields }) as unknown as Request;
const CUSTOMER = { kind: 'customer', id: 5, sessionId: 1 };
const STAFF = { kind: 'staff', id: 2, sessionId: 1, role: 'admin' };

describe('trackerFor', () => {
  it('counts by the client address', () => {
    expect(trackerFor('ip', request({ principal: CUSTOMER }))).toBe('ip:203.0.113.9');
  });

  it('counts by the signed-in customer, else the address', () => {
    expect(trackerFor('customerOrIp', request({ principal: CUSTOMER }))).toBe('customer:5');
    expect(trackerFor('customerOrIp', request({ principal: STAFF }))).toBe('ip:203.0.113.9');
    expect(trackerFor('customerOrIp', request({}))).toBe('ip:203.0.113.9');
  });

  it('counts by the submitted email, normalised and hashed so no address is kept', () => {
    const tracker = trackerFor('email', request({ body: { email: '  Mona@Example.COM ' } }));
    expect(tracker).toBe(`email:${sha256Hex('mona@example.com')}`);
    expect(tracker).not.toContain('mona');
    expect(trackerFor('ipAndEmail', request({ body: { email: 'mona@example.com' } }))).toBe(
      `ip:203.0.113.9|email:${sha256Hex('mona@example.com')}`,
    );
  });

  it('counts by the signed-in customer (else the address) and the booking reference', () => {
    expect(
      trackerFor(
        'customerAndBookingRef',
        request({ principal: CUSTOMER, params: { ref: 'MQ-7Q2K' } }),
      ),
    ).toBe('customer:5|booking:MQ-7Q2K');
    expect(trackerFor('customerAndBookingRef', request({ params: { ref: 'MQ-7Q2K' } }))).toBe(
      'ip:203.0.113.9|booking:MQ-7Q2K',
    );
    expect(
      trackerFor(
        'customerAndBookingRef',
        request({ principal: STAFF, params: { ref: 'MQ-7Q2K' } }),
      ),
    ).toBe('ip:203.0.113.9|booking:MQ-7Q2K');
  });

  it('counts by the booking reference of the path', () => {
    expect(trackerFor('bookingRef', request({ params: { ref: 'mq-7q2k' } }))).toBe(
      'booking:MQ-7Q2K',
    );
  });
});

describe('shouldSkipLimit', () => {
  class Routes {
    @RateLimit('holdIp', 'holdCustomer') hold(): void {}
    plain(): void {}
  }
  const reflector = new Reflector();
  const context = (route: keyof Routes, principal?: object) =>
    fakeContext({ request: { principal }, handler: Routes.prototype[route], controller: Routes });

  it('skips a named limit on routes that did not declare it', () => {
    expect(shouldSkipLimit('holdIp', 'ip', reflector, context('plain'))).toBe(true);
    expect(shouldSkipLimit('search', 'ip', reflector, context('hold'))).toBe(true);
    expect(shouldSkipLimit('holdIp', 'ip', reflector, context('hold'))).toBe(false);
  });

  it('skips a per-customer limit for anyone who is not a signed-in customer', () => {
    expect(shouldSkipLimit('holdCustomer', 'customer', reflector, context('hold'))).toBe(true);
    expect(shouldSkipLimit('holdCustomer', 'customer', reflector, context('hold', STAFF))).toBe(
      true,
    );
    expect(shouldSkipLimit('holdCustomer', 'customer', reflector, context('hold', CUSTOMER))).toBe(
      false,
    );
  });
});

describe('parseRateLimitRule', () => {
  it.each([
    ['300/1m', { limit: 300, windowSeconds: 60 }],
    ['30/10m', { limit: 30, windowSeconds: 600 }],
    ['5/1h', { limit: 5, windowSeconds: 3600 }],
    [' 90/45s ', { limit: 90, windowSeconds: 45 }],
  ])('reads %p', (rule, expected) => {
    expect(parseRateLimitRule(rule)).toEqual(expected);
  });

  it.each(['300', '0/1m', '5/0m', '5/1d', '-1/1m', '1.5/1m', '5 / 1m'])('refuses %p', (rule) => {
    expect(parseRateLimitRule(rule)).toBeUndefined();
  });
});
