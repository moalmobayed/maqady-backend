/** Request header carrying the client's key: a new UUID per user action (design §11). */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

/** Response header on a replayed response. */
export const IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

/** 1–128 characters of letters, digits, `_` and `-`; a UUID fits. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** A key older than this counts as absent (design §6.2, ADR 0003). */
export const IDEMPOTENCY_KEY_TTL_HOURS = 24;

/** How many expired keys one write deletes on the side (design §14.1). */
export const IDEMPOTENCY_PURGE_BATCH = 50;

/** The scope of requests without a principal: guests and public writes. */
export const ANONYMOUS_SCOPE = 'anonymous';

/** A deadlock or serialization failure re-runs the whole request transaction once (design §7.1). */
export const MAX_TRANSACTION_ATTEMPTS = 2;

/** Methods the write interceptor wraps. Everything else runs without a request transaction. */
export const WRITE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Metadata keys of the idempotency decorators. */
export const STRICT_METADATA = 'maqady:idempotency-strict';
export const NO_IDEMPOTENCY_STORAGE_METADATA = 'maqady:idempotency-no-storage';
export const NO_REQUEST_TRANSACTION_METADATA = 'maqady:no-request-transaction';

/** OpenAPI vendor extension the decorators set; the document builder reads and removes it. */
export const IDEMPOTENCY_OPENAPI_EXTENSION = 'x-maqady-idempotency';
