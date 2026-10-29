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
