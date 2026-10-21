/** `payments.kind` (design §6.2): money taken, or money given back. */
export const PAYMENT_KINDS = ['charge', 'refund'] as const;

/**
 * `payments.purpose`: a charge is a `sale` or an `edit_difference` (U14); a refund is a
 * `cancellation` or an `edit_difference`.
 */
export const PAYMENT_PURPOSES = ['sale', 'edit_difference', 'cancellation'] as const;

/** `payments.method`: online (card, wallet) or at the counter (cash, card terminal, U13). */
export const PAYMENT_METHODS = ['card', 'wallet', 'cash', 'card_terminal'] as const;

/** The methods a customer pays with on the website (PRD Payments 1). */
export const ONLINE_PAYMENT_METHODS = ['card', 'wallet'] as const;

/** A charge's statuses: in flight, or one of the three final results (design §7.5). */
export const CHARGE_STATUSES = ['processing', 'succeeded', 'declined', 'cancelled'] as const;

/** A refund's statuses: online refunds succeed at once; counter refunds wait to be paid out (U14). */
export const REFUND_STATUSES = ['pending', 'succeeded'] as const;

/** Every `payments.status`. */
export const PAYMENT_STATUSES = [
  'processing',
  'succeeded',
  'declined',
  'cancelled',
  'pending',
] as const;

/** The card brands a card payment records (PRD C8: Visa, Mastercard, Meeza). */
export const CARD_BRANDS = ['visa', 'mastercard', 'meeza'] as const;

/** The wallets a wallet payment records (PRD C8: Apple Pay, Google Pay). */
export const WALLET_TYPES = ['apple_pay', 'google_pay'] as const;

/**
 * The simulated provider's test tokens (design §7.5; PRD "Payment and messaging providers"): the
 * checkout form sends one of these, never a card number, and it decides the result.
 */
export const SIMULATED_PAYMENT_TOKENS = [
  'sim_card_visa',
  'sim_card_mastercard',
  'sim_card_meeza',
  'sim_card_declined',
  'sim_card_slow',
  'sim_card_slow_declined',
  'sim_wallet_apple_pay',
  'sim_wallet_google_pay',
  'sim_wallet_cancelled',
] as const;
