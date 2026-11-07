/** The Payments screen's period when none is chosen: today and the 6 cinema days before it (PRD A8). */
export const DEFAULT_PERIOD_DAYS = 7;

/** The longest period the summary reads, in cinema days. */
export const MAX_PERIOD_DAYS = 366;

/** At most this many reconciliation mismatches are listed; `truncated` says when there were more. */
export const MISMATCH_LIST_LIMIT = 100;

/** `refundRate` is rounded to this many decimals (0.1234 is 12.34%). */
export const REFUND_RATE_DECIMALS = 4;

/** Occupancy, shares and changes are ratios rounded to this many decimals (0.4567 is 45.67%). */
export const RATIO_DECIMALS = 4;

/** "Top movies by revenue" lists at most this many movies (PRD A1). */
export const TOP_MOVIES_LIMIT = 5;

/** The "Tonight" list shows at most this many of today's showtimes, soonest first (PRD A1). */
export const TONIGHT_LIMIT = 20;

/** "Revenue · last 30 days" (PRD A1): the trend covers this many cinema days. */
export const REVENUE_TREND_DAYS = 30;

/** The period presets in cinema days, ending today. */
export const OVERVIEW_PERIOD_DAYS = { today: 1, '7d': 7, '30d': 30 } as const;

/** A single day compares with the same weekday this many days before (PRD "Comparisons"). */
export const SAME_WEEKDAY_OFFSET_DAYS = 7;

/** A showtime later today with fewer than this share of its seats sold raises `low-sales` (PRD A1). */
export const LOW_SALES_THRESHOLD_PERCENT = 35;

/** `hall-gap` looks at this many cinema days from today (PRD A1 "in the next 7 days"). */
export const HALL_GAP_DAYS = 7;

/**
 * Reads older than this (30 days of real time) are tidied away when a staff member marks alerts
 * read. Every alert key is tied to a cinema day at most `HALL_GAP_DAYS` ahead, so a key this old
 * is never current again.
 */
export const ALERT_READ_RETENTION_HOURS = 30 * 24;

/** `POST /admin/alert-reads` takes at most this many keys at once. */
export const MAX_ALERT_READ_KEYS = 200;

/** An alert key: lowercase letters, digits, `:` and `-` (`chk_staff_alert_reads_alert_key`). */
export const ALERT_KEY_PATTERN = /^[a-z0-9:-]{1,200}$/;
