import type { Currency, Money } from '../../common/money/types';
import type {
  CARD_BRANDS,
  CHARGE_STATUSES,
  COUNTER_PAYMENT_METHODS,
  ONLINE_PAYMENT_METHODS,
  PAYMENT_KINDS,
  PAYMENT_METHODS,
  PAYMENT_PURPOSES,
  PAYMENT_STATUSES,
  SIMULATED_PAYMENT_TOKENS,
  WALLET_TYPES,
} from './enums';

export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type OnlinePaymentMethod = (typeof ONLINE_PAYMENT_METHODS)[number];

export type CounterPaymentMethod = (typeof COUNTER_PAYMENT_METHODS)[number];

export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

/** A charge result that is final: everything but `processing`. */
export type FinalChargeStatus = Exclude<ChargeStatus, 'processing'>;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type CardBrand = (typeof CARD_BRANDS)[number];

export type WalletType = (typeof WALLET_TYPES)[number];

export type SimulatedPaymentToken = (typeof SIMULATED_PAYMENT_TOKENS)[number];

// --- Rows -----------------------------------------------------------------------------------

/** A `payments` row as the repository reads it (design §6.2). */
export interface PaymentRow {
  readonly id: number;
  readonly booking_id: number;
  readonly kind: PaymentKind;
  readonly purpose: PaymentPurpose;
  readonly method: PaymentMethod;
  readonly status: PaymentStatus;
  readonly amount: number;
  readonly currency: Currency;
  readonly refund_of_payment_id: number | null;
  readonly provider_idempotency_key: string | null;
  readonly provider_reference: string | null;
  readonly card_brand: CardBrand | null;
  readonly card_last4: string | null;
  readonly wallet_type: WalletType | null;
  readonly settles_at: Date | null;
  readonly completed_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** The columns of a new online charge or refund. */
export interface NewPaymentRow {
  readonly booking_id: number;
  readonly kind: PaymentKind;
  readonly purpose: PaymentPurpose;
  readonly method: OnlinePaymentMethod;
  readonly status: PaymentStatus;
  readonly amount: number;
  readonly currency: Currency;
  readonly refund_of_payment_id: number | null;
  readonly provider_idempotency_key: string;
  readonly provider_reference: string | null;
  readonly card_brand: CardBrand | null;
  readonly card_last4: string | null;
  readonly wallet_type: WalletType | null;
  readonly settles_at: Date | null;
  readonly completed_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/**
 * The columns of a counter charge (U13): recorded once the money is taken, so it is `succeeded`
 * at once, with the member who collected it and, for a card terminal, the receipt reference in
 * `provider_reference`. No provider call, so no provider key and no `settles_at`.
 */
export interface NewCounterChargeRow {
  readonly booking_id: number;
  readonly kind: 'charge';
  readonly purpose: 'sale' | 'edit_difference';
  readonly method: CounterPaymentMethod;
  readonly status: 'succeeded';
  readonly amount: number;
  readonly currency: Currency;
  readonly provider_reference: string | null;
  readonly collected_by_staff_id: number;
  readonly completed_at: Date;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** What recording a provider result writes onto a charge. */
export interface ChargeResultColumns {
  readonly status: ChargeStatus;
  readonly provider_reference: string;
  readonly card_brand: CardBrand | null;
  readonly card_last4: string | null;
  readonly wallet_type: WalletType | null;
  readonly settles_at: Date | null;
  readonly completed_at: Date | null;
  readonly updated_at: Date;
}

/** One charge that settlement finishes, as the repository writes it. */
export interface FinishedChargeRow {
  readonly id: number;
  readonly status: FinalChargeStatus;
}

/** How many of a booking's rows are counted, by booking. */
export interface BookingCountRow {
  readonly booking_id: number;
  readonly count: number;
}

// --- Domain ---------------------------------------------------------------------------------

/** A card as a payment records it: its brand and last four digits, never more. */
export interface PaymentCard {
  readonly brand: CardBrand;
  readonly last4: string;
}

/** A payment or refund as the services see it. */
export interface Payment {
  readonly id: number;
  readonly bookingId: number;
  readonly kind: PaymentKind;
  readonly purpose: PaymentPurpose;
  readonly method: PaymentMethod;
  readonly status: PaymentStatus;
  readonly amount: Money;
  readonly refundOfPaymentId: number | null;
  readonly providerReference: string | null;
  readonly card: PaymentCard | null;
  readonly walletType: WalletType | null;
  /** When a processing charge's result is ready; kept once it is final. */
  readonly settlesAt: Date | null;
  readonly completedAt: Date | null;
  readonly createdAt: Date;
}

// --- Provider -------------------------------------------------------------------------------

/** A charge as the provider is asked for it, with our idempotency key (design §7.5). */
export interface ChargeRequest {
  readonly amount: Money;
  readonly method: OnlinePaymentMethod;
  readonly token: string;
  readonly idempotencyKey: string;
}

/** What the provider says about a charge, at the charge or at a later retrieve. */
export interface ChargeResult {
  readonly status: ChargeStatus;
  readonly providerReference: string;
  /** When a `processing` charge's result will be ready; null once it is final at once. */
  readonly settlesAt: Date | null;
  readonly card: PaymentCard | null;
  readonly walletType: WalletType | null;
}

/** Asks the provider for a charge's current result. */
export interface RetrieveRequest {
  readonly providerReference: string;
}

/** Gives a charge's money back through the provider. */
export interface RefundRequest {
  readonly chargeReference: string;
  readonly amount: Money;
  readonly idempotencyKey: string;
}

export interface RefundResult {
  readonly status: 'succeeded';
  readonly providerReference: string;
}

/** What one simulated test token does (design §7.5, README "Checkout and tickets"). */
export interface SimulatedOutcome {
  readonly method: OnlinePaymentMethod;
  /** The result once final. */
  readonly result: FinalChargeStatus;
  /** True for the slow tokens: `processing` first, final `SIMULATED_SETTLE_SECONDS` later. */
  readonly slow: boolean;
  readonly card: PaymentCard | null;
  readonly walletType: WalletType | null;
}

// --- Service inputs -------------------------------------------------------------------------

/** A booking's online sale charge, as checkout asks for it. */
export interface OnlineChargeInput {
  readonly bookingId: number;
  /** The booking reference: our provider keys are built from it. */
  readonly reference: string;
  readonly amount: Money;
  readonly method: OnlinePaymentMethod;
  readonly token: SimulatedPaymentToken;
}

/**
 * Money taken at the counter (PRD Payments 2), as the box office records it: a `sale` (U13) or
 * the higher total of an edit (`edit_difference`, U14). The receipt reference is required for a
 * card terminal and absent for cash.
 */
export interface CounterChargeInput {
  readonly bookingId: number;
  readonly amount: Money;
  readonly method: CounterPaymentMethod;
  readonly receiptReference: string | null;
  readonly purpose: 'sale' | 'edit_difference';
  readonly collectedByStaffId: number;
}

/** A succeeded online charge to give back in full, as settlement asks for it. */
export interface OnlineRefundInput {
  readonly charge: Payment;
  readonly reference: string;
}

/** A processing charge whose result is due, with what settlement needs to finish it. */
export interface DueCharge {
  readonly paymentId: number;
  readonly bookingId: number;
  readonly providerReference: string;
  readonly settlesAt: Date;
}

/** Where a page of due charges ends: the next page starts after this `(settles_at, id)`. */
export interface DueCursor {
  readonly settlesAt: Date;
  readonly paymentId: number;
}

/** A due charge and the final result the provider gave for it. */
export interface ChargeOutcome {
  readonly paymentId: number;
  readonly result: ChargeResult;
}

// --- Admin ledger, refunds per charge and payouts (U14) --------------------------------------

/** Why a refund was made: the booking was cancelled, or an edit lowered its total (U14). */
export type RefundPurpose = Extract<PaymentPurpose, 'cancellation' | 'edit_difference'>;

/**
 * A `payments` row with the counter and payout columns and, for a charge, how much of it has been
 * refunded so far (the sum of the refunds naming it), as the admin screens read it (U14).
 */
export interface LedgerRow extends PaymentRow {
  readonly collected_by_staff_id: number | null;
  readonly paid_out_at: Date | null;
  readonly paid_out_by_staff_id: number | null;
  readonly refunded_amount: number;
}

/** A payment or refund with everything the admin booking detail and the Payments screen show. */
export interface LedgerEntry extends Payment {
  /** The staff member who took a counter charge; null otherwise. */
  readonly collectedByStaffId: number | null;
  /** When a counter refund was paid out, and by whom; null until then (and for every other row). */
  readonly paidOutAt: Date | null;
  readonly paidOutByStaffId: number | null;
  /**
   * A succeeded charge's remaining refundable amount (design §7.7: its amount minus the refunds
   * that name it); null for any other row.
   */
  readonly refundable: Money | null;
}

/** One refund to make: this much of this succeeded charge, on the charge's own rail. */
export interface RefundItem {
  readonly charge: LedgerEntry;
  readonly amount: Money;
  /** The booking's reference, for the provider key `<reference>-r<n>`. */
  readonly reference: string;
}

/** A refund row as `insertRefunds()` writes it: online (`succeeded`, with a key) or counter (`pending`). */
export interface NewRefundRow {
  readonly booking_id: number;
  readonly kind: 'refund';
  readonly purpose: RefundPurpose;
  readonly method: PaymentMethod;
  readonly status: 'succeeded' | 'pending';
  readonly amount: number;
  readonly currency: Currency;
  readonly refund_of_payment_id: number;
  readonly provider_idempotency_key: string | null;
  readonly provider_reference: string | null;
  readonly completed_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** The money that moved in a period, as one row of sums (piastres) and counts. */
export interface MoneyMovedRow {
  readonly collected: number;
  readonly declined: number;
}

/** The money that moved in a period (PRD "Collected": taken minus refunds paid out), and declines. */
export interface MoneyMoved {
  readonly collected: Money;
  readonly declinedCount: number;
}

/** A half-open period of instants, `[from, to)`. */
export interface InstantRange {
  readonly from: Date;
  readonly to: Date;
}
