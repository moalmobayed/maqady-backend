/** The Payments screen's period when none is chosen: today and the 6 cinema days before it (PRD A8). */
export const DEFAULT_PERIOD_DAYS = 7;

/** The longest period the summary reads, in cinema days. */
export const MAX_PERIOD_DAYS = 366;

/** At most this many reconciliation mismatches are listed; `truncated` says when there were more. */
export const MISMATCH_LIST_LIMIT = 100;

/** `refundRate` is rounded to this many decimals (0.1234 is 12.34%). */
export const REFUND_RATE_DECIMALS = 4;
