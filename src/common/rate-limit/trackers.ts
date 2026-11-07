import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { sha256Hex } from '../crypto/hashing';
import { RATE_LIMITS_METADATA } from './rate-limit.constants';
import type { NamedRateLimit, RateLimitKey } from './types';

/** The client address Express derived (one trusted proxy hop), or a fixed bucket when unknown. */
function ipOf(request: Request): string {
  return `ip:${request.ip ?? 'unknown'}`;
}

/** The submitted email, lower-cased and hashed: a throttler key never holds personal data. */
function emailOf(request: Request): string {
  const body = request.body as { email?: unknown } | undefined;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  return `email:${sha256Hex(email)}`;
}

function customerOf(request: Request): string | undefined {
  return request.principal?.kind === 'customer' ? `customer:${request.principal.id}` : undefined;
}

function bookingRefOf(request: Request): string {
  const ref = request.params?.ref;
  return `booking:${typeof ref === 'string' ? ref.toUpperCase() : 'unknown'}`;
}

/** The string a limit counts requests by (see `RATE_LIMIT_KEYS`). */
export function trackerFor(key: RateLimitKey, request: Request): string {
  switch (key) {
    case 'ip':
      return ipOf(request);
    case 'customerOrIp':
    case 'customer':
      return customerOf(request) ?? ipOf(request);
    case 'email':
      return emailOf(request);
    case 'ipAndEmail':
      return `${ipOf(request)}|${emailOf(request)}`;
    case 'bookingRef':
      return bookingRefOf(request);
    case 'customerAndBookingRef':
      return `${customerOf(request) ?? ipOf(request)}|${bookingRefOf(request)}`;
  }
}

/**
 * True when a named limit does not apply to this request: the route didn't opt into it, or it
 * counts by customer and nobody is signed in as one.
 */
export function shouldSkipLimit(
  name: NamedRateLimit,
  key: RateLimitKey,
  reflector: Reflector,
  context: ExecutionContext,
): boolean {
  const declared = reflector.getAllAndOverride<NamedRateLimit[] | undefined>(RATE_LIMITS_METADATA, [
    context.getHandler(),
    context.getClass(),
  ]);
  if (!declared?.includes(name)) return true;
  if (key !== 'customer') return false;
  return customerOf(context.switchToHttp().getRequest<Request>()) === undefined;
}
