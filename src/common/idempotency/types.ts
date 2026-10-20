import type { IDEMPOTENCY_MODES } from './enums';

export type IdempotencyMode = (typeof IDEMPOTENCY_MODES)[number];

/** How the write interceptor treats a route, from its decorators. */
export interface WriteRouteOptions {
  readonly strict: boolean;
  readonly storeResponses: boolean;
  readonly requestTransaction: boolean;
}

/** One key, as a write claims it. */
export interface IdempotencyKeyInput {
  /** `customer:<id>`, `staff:<id>` or `anonymous`. */
  readonly scope: string;
  readonly key: string;
  /** SHA-256 hex of the canonical request (method, route, path params, body). */
  readonly requestHash: string;
}

/** The outcome of claiming a key: run the handler, or replay the stored response. */
export type IdempotencyClaim =
  | { readonly kind: 'claimed'; readonly id: number }
  | { readonly kind: 'replay'; readonly status: number; readonly body: unknown };

/** An `idempotency_keys` row as the repository reads it. */
export interface StoredIdempotencyKey {
  readonly id: number;
  readonly request_hash: string;
  readonly response_status: number | null;
  readonly response_ciphertext: string | null;
}

/** The parts of a request its hash covers. */
export interface HashedRequest {
  readonly method: string;
  readonly route: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly body: unknown;
}
