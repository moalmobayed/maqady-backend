/** A slow simulated charge is `processing` for this long, then final (design §7.5). */
export const SIMULATED_SETTLE_SECONDS = 10;

/** At most this many due charges are settled by one settlement, oldest `settles_at` first. */
export const SETTLEMENT_BATCH_LIMIT = 100;

/** Our provider idempotency keys: `<reference>-c<n>` for a sale charge, `-r<n>` for a refund. */
export const PROVIDER_KEY_PATTERN = /^MQ-[2-9A-HJKMNP-Z]{6}-[cr][1-9][0-9]*$/;

/** The simulated provider's references: `sim.<token>.<settles at, ms>.<16 hex>`, refunds `simr.<16 hex>`. */
export const SIMULATED_CHARGE_REFERENCE_PATTERN =
  /^sim\.(sim_[a-z_]+)\.([0-9]{1,15})\.([0-9a-f]{16})$/;
export const SIMULATED_REFUND_PREFIX = 'simr.';
