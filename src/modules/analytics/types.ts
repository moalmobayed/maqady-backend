import type { Currency, Money } from '../../common/money/types';
import type { CalendarDate } from '../../common/time/types';
import type { BookingChannel, StaffRef } from '../bookings/types';
import type {
  CardBrand,
  ChargeStatus,
  PaymentCard,
  PaymentKind,
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
  WalletType,
} from '../payments/types';
import type {
  PAYMENT_CHANNELS,
  RECONCILIATION_CHECKS,
  TRANSACTION_FAILURE_REASONS,
  TRANSACTION_STATUSES,
} from './enums';

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export type TransactionFailureReason = (typeof TRANSACTION_FAILURE_REASONS)[number];

export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

export type ReconciliationCheck = (typeof RECONCILIATION_CHECKS)[number];

/** A bound SQL condition the repository ANDs; aliases and columns are code constants. */
export interface TransactionSqlCondition {
  readonly sql: string;
  readonly bindings: readonly unknown[];
}

// --- Rows -----------------------------------------------------------------------------------

/**
 * One `payments` row on the Payments screen, with its booking, its showtime's theater and, for a
 * charge, the sums of its succeeded and pending refunds (0 for a refund row).
 */
export interface TransactionRow {
  readonly id: number;
  readonly booking_id: number;
  readonly kind: PaymentKind;
  readonly purpose: PaymentPurpose;
  readonly method: PaymentMethod;
  readonly status: PaymentStatus;
  readonly amount: number;
  readonly currency: Currency;
  readonly refund_of_payment_id: number | null;
  readonly provider_reference: string | null;
  readonly card_brand: CardBrand | null;
  readonly card_last4: string | null;
  readonly wallet_type: WalletType | null;
  readonly collected_by_staff_id: number | null;
  readonly paid_out_at: Date | null;
  readonly paid_out_by_staff_id: number | null;
  readonly created_at: Date;
  readonly completed_at: Date | null;
  /** `COALESCE(completed_at, created_at)`: when the money moved, or the row was written. */
  readonly occurred_at: Date;
  readonly booking_reference: string;
  readonly booking_channel: BookingChannel;
  readonly contact_name: string | null;
  readonly theater_id: number;
  readonly theater_name: string;
  readonly refunded_amount: number;
  readonly pending_refund_amount: number;
}

/**
 * The money of one theater, kind and method whose `completed_at` falls in a period: succeeded
 * sums and counts, and the failed charges.
 */
export interface PeriodAggregateRow {
  readonly theater_id: number;
  readonly theater_name: string;
  readonly kind: PaymentKind;
  readonly method: PaymentMethod;
  readonly succeeded_amount: number;
  readonly succeeded_count: number;
  readonly declined_count: number;
  readonly cancelled_count: number;
}

/** An online charge final in the ledger, or a succeeded online refund, completed in a period. */
export interface OnlineCheckRow {
  readonly id: number;
  readonly kind: PaymentKind;
  readonly status: PaymentStatus;
  readonly amount: number;
  readonly currency: Currency;
  readonly provider_reference: string | null;
  readonly booking_reference: string;
}

/** A booking whose succeeded charges minus refunds differ from what it should hold. */
export interface BalanceMismatchRow {
  readonly booking_id: number;
  readonly reference: string;
  readonly status: string;
  readonly currency: Currency;
  readonly expected: number;
  readonly actual: number;
}

/** A charge whose refunds add up to more than it took. */
export interface OverRefundRow {
  readonly payment_id: number;
  readonly reference: string;
  readonly currency: Currency;
  readonly amount: number;
  readonly refunded: number;
}

// --- Inputs ---------------------------------------------------------------------------------

/** `GET /admin/payments` filters (PRD A8 "Filters by method, status and date range"), ANDed. */
export interface TransactionFilter {
  readonly kind?: PaymentKind;
  readonly method?: PaymentMethod;
  readonly channel?: PaymentChannel;
  readonly status?: TransactionStatus;
  readonly theaterId?: number;
  /** Cinema dates of `occurredAt`, inclusive. */
  readonly dateFrom?: CalendarDate;
  readonly dateTo?: CalendarDate;
}

/** What decides a row's shown status. */
export interface TransactionStatusInput {
  readonly kind: PaymentKind;
  readonly status: PaymentStatus;
  readonly amount: number;
  /** A charge's succeeded refunds so far (piastres); ignored for a refund. */
  readonly refundedAmount: number;
}

/** The summary's period as the query gives it; omitted dates take the defaults. */
export interface PeriodQuery {
  readonly dateFrom?: CalendarDate;
  readonly dateTo?: CalendarDate;
}

// --- Domain ---------------------------------------------------------------------------------

/** A booking as a transaction names it, for "open the booking". */
export interface TransactionBooking {
  readonly reference: string;
  readonly channel: BookingChannel;
  readonly contactName: string | null;
}

export interface TheaterRef {
  readonly id: number;
  readonly name: string;
}

/** One row of the Payments screen's transactions table. */
export interface Transaction {
  readonly id: number;
  readonly kind: PaymentKind;
  readonly purpose: PaymentPurpose;
  readonly method: PaymentMethod;
  readonly channel: PaymentChannel;
  readonly status: TransactionStatus;
  readonly failureReason: TransactionFailureReason | null;
  readonly ledgerStatus: PaymentStatus;
  /** Signed: negative for a refund. */
  readonly amount: Money;
  readonly refundOfPaymentId: number | null;
  readonly refundedAmount: Money | null;
  readonly pendingRefundAmount: Money | null;
  readonly booking: TransactionBooking;
  readonly theater: TheaterRef;
  readonly card: PaymentCard | null;
  readonly walletType: WalletType | null;
  readonly receiptReference: string | null;
  readonly collectedBy: StaffRef | null;
  readonly paidOutAt: Date | null;
  readonly paidOutBy: StaffRef | null;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
  readonly occurredAt: Date;
  readonly cinemaDate: CalendarDate;
  readonly actions: { readonly markPaidOut: boolean };
}

/** A period of whole cinema days, and the instants `[from, to)` it covers. */
export interface PaymentPeriod {
  readonly dateFrom: CalendarDate;
  readonly dateTo: CalendarDate;
  readonly from: Date;
  readonly to: Date;
}

/** Money moved in a period: succeeded charges, succeeded refunds and their difference. */
export interface PaymentTotals {
  readonly gross: Money;
  readonly chargeCount: number;
  readonly refunds: Money;
  readonly refundCount: number;
  readonly net: Money;
}

export interface ChannelTotals extends PaymentTotals {
  readonly channel: PaymentChannel;
}

export interface MethodTotals extends PaymentTotals {
  readonly method: PaymentMethod;
}

/** Charges shown `failed`: declined, or a wallet the customer closed. */
export interface FailedCounts {
  readonly count: number;
  readonly declinedCount: number;
  readonly cancelledCount: number;
}

/** The PRD's four cards (A8). */
export interface PaymentsKpis {
  readonly collectedOnline: Money;
  readonly collectedAtCounters: Money;
  readonly refunds: Money;
  /** Refunds ÷ gross in the period, rounded; null when nothing was taken. */
  readonly refundRate: number | null;
  /** Charges failed on today's cinema day. */
  readonly failedToday: number;
}

/** "Online, Cash, Terminal, Refunds, Net" (PRD A8). */
export interface ReconciliationAmounts {
  readonly online: Money;
  readonly cash: Money;
  readonly cardTerminal: Money;
  readonly refunds: Money;
  readonly net: Money;
}

export interface TheaterReconciliation extends ReconciliationAmounts {
  readonly theater: TheaterRef;
}

/** The payment provider's side of the period's final online charges. */
export interface ProviderCheck {
  readonly checkedCount: number;
  readonly ledgerSucceeded: Money;
  readonly providerSucceeded: Money;
  readonly matched: boolean;
}

/** One record that does not add up. */
export interface ReconciliationMismatch {
  readonly check: ReconciliationCheck;
  readonly bookingReference: string;
  readonly paymentId: number | null;
  readonly expectedAmount: Money | null;
  readonly actualAmount: Money | null;
  readonly ledgerStatus: PaymentStatus | null;
  readonly providerStatus: ChargeStatus | null;
  readonly message: string;
}

export interface Reconciliation {
  readonly byTheater: readonly TheaterReconciliation[];
  readonly totals: ReconciliationAmounts;
  readonly provider: ProviderCheck;
  readonly mismatches: readonly ReconciliationMismatch[];
  readonly truncated: boolean;
  readonly consistent: boolean;
}

/** `GET /admin/payments/summary`. */
export interface PaymentsSummary {
  readonly period: PaymentPeriod;
  readonly cinemaDate: CalendarDate;
  readonly serverTime: Date;
  readonly kpis: PaymentsKpis;
  readonly totals: PaymentTotals;
  readonly byChannel: readonly ChannelTotals[];
  readonly byMethod: readonly MethodTotals[];
  readonly failed: FailedCounts;
  readonly reconciliation: Reconciliation;
}

/** The provider side of the check, before it is folded into the reconciliation. */
export interface ProviderCheckResult {
  readonly provider: ProviderCheck;
  readonly mismatches: readonly ReconciliationMismatch[];
}
