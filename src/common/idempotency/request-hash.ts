import type { Request } from 'express';
import { sha256Hex } from '../crypto/hashing';
import { routeTemplateOf } from '../logging/logger.params';
import { HOLD_TOKEN_HEADER } from './idempotency.constants';
import type { HashedRequest } from './types';

/**
 * JSON with object keys sorted at every level, so `{a,b}` and `{b,a}` hash the same. Arrays keep
 * their order. `undefined` properties are dropped, as `JSON.stringify` drops them.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`);
  return `{${entries.join(',')}}`;
}

/**
 * SHA-256 of the method, route template, path parameters, body (design §14.1) and the guest's
 * hold code. Guests share the `anonymous` scope and prove their access with the hold code, which
 * the handler checks; a replay skips the handler, so the code must match for a replay too.
 */
export function hashRequest(request: HashedRequest): string {
  return sha256Hex(
    canonicalJson([
      request.method,
      request.route,
      request.params,
      request.body ?? null,
      request.holdToken,
    ]),
  );
}

/** The hashed parts of an Express request, read before validation transforms the body. */
export function hashedPartsOf(request: Request): HashedRequest {
  const holdToken = request.headers[HOLD_TOKEN_HEADER.toLowerCase()];
  return {
    method: request.method,
    route: routeTemplateOf(request) ?? request.path,
    params: { ...request.params },
    body: request.body as unknown,
    holdToken: typeof holdToken === 'string' ? holdToken : null,
  };
}
