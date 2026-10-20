import { randomUUID } from 'node:crypto';

/** Request header a client may send, and response header we always send, carrying the id. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * The correlation id for a request: the client's `X-Request-Id` when it is a UUID (lower-cased),
 * otherwise a new random UUID. Anything else a client sends is ignored, so log lines and error
 * bodies only ever carry a UUID.
 */
export function resolveCorrelationId(header: string | readonly string[] | undefined): string {
  const candidate = typeof header === 'string' ? header.trim() : '';
  return isUuid(candidate) ? candidate.toLowerCase() : randomUUID();
}
