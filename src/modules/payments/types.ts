import type { Currency, Money } from '../../common/money/types';
import type {
  CARD_BRANDS,
  CHARGE_STATUSES,
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
}

/** A due charge and the final result the provider gave for it. */
export interface ChargeOutcome {
  readonly paymentId: number;
  readonly result: ChargeResult;
}
