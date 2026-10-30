/**
 * A transaction's status as the Payments screen shows it (design §13.3; PRD "Payments screen
 * transactions"): `transactionStatusOf()` maps every stored payment status onto one of these.
 */
export const TRANSACTION_STATUSES = ['succeeded', 'pending', 'failed', 'refunded'] as const;

/** Why a charge is shown `failed`: declined by the provider, or a wallet the customer closed. */
export const TRANSACTION_FAILURE_REASONS = ['declined', 'cancelled'] as const;

/** Where money moved: `online` (card, wallet) or at a `counter` (cash, card terminal). */
export const PAYMENT_CHANNELS = ['online', 'counter'] as const;

/**
 * The reconciliation's checks (U16): a booking whose charges minus refunds differ from what it
 * should hold, a charge refunded beyond its amount, an online charge whose status the provider
 * disagrees with or does not know, and an online row with no provider reference.
 */
export const RECONCILIATION_CHECKS = [
  'booking_balance',
  'over_refunded',
  'provider_status',
  'provider_unknown',
  'missing_provider_reference',
] as const;

/**
 * The Overview's period presets (PRD A1 "Today, 7 days, 30 days, in cinema days"): today alone,
 * or the last 7 or 30 cinema days ending today.
 */
export const OVERVIEW_PERIODS = ['today', '7d', '30d'] as const;

/**
 * What the KPI cards compare with (PRD "Comparisons"): a single day against the same weekday last
 * week, a longer period against the period just before it.
 */
export const COMPARISON_BASES = ['same_weekday_last_week', 'previous_period'] as const;

/**
 * The busy-times heatmap's columns (design §13.3 "Heatmap slots"), by the showtime's local start
 * time: before 15:00 (morning shows included), 15–18, 18–21, 21–24 and after midnight.
 */
export const SHOWTIME_SLOTS = ['before_15', '15_18', '18_21', '21_24', 'after_midnight'] as const;

/**
 * The bell's alerts (design §13.3 "Alerts"; PRD A1 "Needs attention"), in the order the panel
 * lists them: failed online payments today, showtimes later today under 35% sold, and active halls
 * with no showtimes on a cinema day in the next 7.
 */
export const ALERT_KINDS = ['failed_payments', 'low_sales', 'hall_gap'] as const;
