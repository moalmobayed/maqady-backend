/**
 * How a write route treats `Idempotency-Key`, as documented in the API reference:
 *
 * - `optional`: the default for every write; a key, when sent, makes retries safe.
 * - `required`: `@Strict()`; a missing key is `IDEMPOTENCY_KEY_REQUIRED`.
 * - `ignored`: `@NoIdempotencyStorage()` (auth routes); responses carry credentials and are never stored.
 */
export const IDEMPOTENCY_MODES = ['optional', 'required', 'ignored'] as const;
