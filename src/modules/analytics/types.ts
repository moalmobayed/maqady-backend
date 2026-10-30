import type { Currency, Money } from '../../common/money/types';
import type { Page } from '../../common/pagination/types';
import type { CalendarDate, IsoWeekday } from '../../common/time/types';
import type { BookingChannel, StaffRef } from '../bookings/types';
import type { ShowtimeStatus } from '../showtimes/types';
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
  ALERT_KINDS,
  COMPARISON_BASES,
  OVERVIEW_PERIODS,
  PAYMENT_CHANNELS,
  RECONCILIATION_CHECKS,
  SHOWTIME_SLOTS,
  TRANSACTION_FAILURE_REASONS,
  TRANSACTION_STATUSES,
} from './enums';

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export type TransactionFailureReason = (typeof TRANSACTION_FAILURE_REASONS)[number];

export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

export type ReconciliationCheck = (typeof RECONCILIATION_CHECKS)[number];

export type OverviewPeriodPreset = (typeof OVERVIEW_PERIODS)[number];

export type ComparisonBasis = (typeof COMPARISON_BASES)[number];

export type ShowtimeSlot = (typeof SHOWTIME_SLOTS)[number];

export type AlertKind = (typeof ALERT_KINDS)[number];

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

/** What a provider check knows of a mismatched online row: its ledger status, the provider's, and why. */
export interface ProviderMismatchFacts {
  readonly ledgerStatus: PaymentStatus;
  readonly providerStatus?: ChargeStatus;
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

// --- Overview (U17) -------------------------------------------------------------------------

/**
 * One showtime of a period with what its Confirmed and Completed bookings hold: the revenue and
 * tickets the PRD counts on the showtime's cinema day ("Dashboard numbers").
 */
export interface ShowtimeAggregateRow {
  readonly showtime_id: number;
  readonly theater_id: number;
  readonly hall_id: number;
  readonly movie_id: number;
  readonly cinema_date: CalendarDate;
  readonly starts_at: Date;
  readonly status: ShowtimeStatus;
  readonly seat_capacity: number;
  readonly revenue: number;
  readonly tickets: number;
}

/**
 * The money of a period's Confirmed and Completed bookings by theater and payment method:
 * succeeded charges minus refunds (pending ones included), so a consistent ledger's methods add up
 * to the bookings' totals.
 */
export interface MethodSplitRow {
  readonly theater_id: number;
  readonly method: PaymentMethod;
  readonly amount: number;
}

/** The revenue of one theater on one cinema day. */
export interface DailyRevenueRow {
  readonly cinema_date: CalendarDate;
  readonly theater_id: number;
  readonly revenue: number;
}

/** One of today's showtimes for the "Tonight" list, with its names and what it sold. */
export interface TonightRow {
  readonly showtime_id: number;
  readonly starts_at: Date;
  readonly ends_at: Date;
  readonly cinema_date: CalendarDate;
  readonly seat_capacity: number;
  readonly theater_id: number;
  readonly theater_name: string;
  readonly hall_id: number;
  readonly hall_name: string;
  readonly movie_id: number;
  readonly movie_title: string;
  readonly tickets: number;
  readonly revenue: number;
  /** How many of today's showtimes match, beyond the page too. */
  readonly total_count: number;
}

/** A movie or hall as the Overview and the bell name it: its id and its name (a movie's title). */
export type NamedRef = TheaterRef;

/** The Overview's theater condition on `showtimes s`: empty for every theater. */
export interface TheaterScopeSql {
  readonly sql: string;
  readonly bindings: readonly number[];
}

/** The dates a period is compared with, and why those. */
export interface ComparisonDates {
  readonly dateFrom: CalendarDate;
  readonly dateTo: CalendarDate;
  readonly basis: ComparisonBasis;
}

/** The theaters, halls and movies a period's rows name. */
export interface NamedIds {
  readonly theaterIds: readonly number[];
  readonly hallIds: readonly number[];
  readonly movieIds: readonly number[];
}

/** An id and a name read back for the Overview's rows. */
export interface NamedRow {
  readonly id: number;
  readonly name: string;
}

/** `GET /admin/overview` as the query gives it. */
export interface OverviewQuery {
  readonly period?: OverviewPeriodPreset;
  readonly dateFrom?: CalendarDate;
  readonly dateTo?: CalendarDate;
  readonly theaterId?: number;
}

/** The Overview's period: a preset or chosen dates, as whole cinema days. */
export interface OverviewPeriod extends PaymentPeriod {
  readonly preset: OverviewPeriodPreset | null;
  readonly days: number;
}

/** What the period is compared with (PRD "Comparisons"). */
export interface ComparisonPeriod extends PaymentPeriod {
  readonly basis: ComparisonBasis;
  readonly days: number;
}

/** The five PRD figures of one period (A1 KPI cards; "Dashboard numbers"). */
export interface OverviewFigures {
  readonly revenue: Money;
  readonly ticketsSold: number;
  readonly seatsOnSale: number;
  /** Tickets sold ÷ seats on sale of the scheduled showtimes; null without any. */
  readonly occupancy: number | null;
  /** Revenue ÷ tickets sold, in whole piastres; null without tickets. */
  readonly averageTicket: Money | null;
  /** Money taken at the box office ÷ all money of the period's bookings; null without any. */
  readonly counterShare: number | null;
}

/** One KPI card: the period's value, the comparison's, and the relative change. */
export interface KpiCard<T> {
  readonly value: T;
  readonly previous: T;
  /** `(value − previous) ÷ previous`, rounded; null when `previous` is 0 or null. */
  readonly change: number | null;
}

export interface OverviewKpis {
  readonly revenue: KpiCard<Money>;
  readonly ticketsSold: KpiCard<number>;
  readonly occupancy: KpiCard<number | null>;
  readonly averageTicket: KpiCard<Money | null>;
  readonly counterShare: KpiCard<number | null>;
}

/** Sold, on sale and the share between them, for a theater, hall, movie or heatmap cell. */
export interface SalesFigures {
  readonly revenue: Money;
  readonly ticketsSold: number;
  readonly seatsOnSale: number;
  readonly occupancy: number | null;
  readonly showtimeCount: number;
}

/** A row of "Revenue by theater" (PRD A1): the theater's figures, its Online / Counter split, and its comparison. */
export interface TheaterRevenue extends SalesFigures {
  readonly theater: TheaterRef;
  readonly averageTicket: Money | null;
  readonly online: Money;
  readonly counter: Money;
  readonly previousRevenue: Money;
  readonly change: number | null;
}

/** A row of "Revenue by hall", when one theater is selected (PRD A1). */
export interface HallRevenue extends SalesFigures {
  readonly hall: NamedRef;
}

/** A row of "Top movies by revenue" (PRD A1). */
export interface MovieRevenue extends SalesFigures {
  readonly movie: NamedRef;
}

/** One slice of "Payment methods" (PRD A1): card, wallet, cash, card terminal. */
export interface MethodRevenue {
  readonly method: PaymentMethod;
  readonly amount: Money;
  /** The slice ÷ all methods, rounded; null when nothing was taken. */
  readonly share: number | null;
}

/** One cell of the busy-times heatmap: a weekday of the cinema date and a start-time slot. */
export interface HeatmapCell {
  readonly weekday: IsoWeekday;
  readonly slot: ShowtimeSlot;
  readonly showtimeCount: number;
  readonly ticketsSold: number;
  readonly seatsOnSale: number;
  readonly occupancy: number | null;
}

/** Revenue on one cinema day. */
export interface RevenuePoint {
  readonly cinemaDate: CalendarDate;
  readonly revenue: Money;
}

/** One theater's line on "Revenue · last 30 days". */
export interface TheaterRevenueSeries {
  readonly theater: TheaterRef;
  readonly points: readonly RevenuePoint[];
}

/** "Revenue · last 30 days" (PRD A1): every cinema day of the window, all theaters and each one. */
export interface RevenueTrend {
  readonly dateFrom: CalendarDate;
  readonly dateTo: CalendarDate;
  readonly totals: readonly RevenuePoint[];
  readonly theaters: readonly TheaterRevenueSeries[];
}

/** A showtime of the "Tonight" list. */
export interface TonightShowtime {
  readonly showtimeId: number;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly cinemaDate: CalendarDate;
  readonly hasStarted: boolean;
  readonly movie: NamedRef;
  readonly theater: TheaterRef;
  readonly hall: NamedRef;
  readonly ticketsSold: number;
  readonly seatCapacity: number;
  /** Tickets sold ÷ seats, rounded. */
  readonly soldShare: number;
  readonly revenue: Money;
}

export interface TonightList {
  readonly cinemaDate: CalendarDate;
  readonly items: readonly TonightShowtime[];
  /** Today's showtimes still to end, beyond the list too. */
  readonly total: number;
}

/** `GET /admin/overview`. */
export interface Overview {
  readonly period: OverviewPeriod;
  readonly comparison: ComparisonPeriod;
  readonly theater: TheaterRef | null;
  readonly cinemaDate: CalendarDate;
  readonly serverTime: Date;
  readonly kpis: OverviewKpis;
  readonly byTheater: readonly TheaterRevenue[];
  /** Null unless one theater is selected. */
  readonly byHall: readonly HallRevenue[] | null;
  readonly paymentMethods: readonly MethodRevenue[];
  readonly topMovies: readonly MovieRevenue[];
  readonly heatmap: readonly HeatmapCell[];
  readonly revenueTrend: RevenueTrend;
  readonly tonight: TonightList;
}

/** The figures of one period before folding, as the repository reads them. */
export interface PeriodRows {
  readonly showtimes: readonly ShowtimeAggregateRow[];
  readonly methods: readonly MethodSplitRow[];
}

/** The names the folds need, read in one batch per table. */
export interface OverviewNames {
  readonly theaters: ReadonlyMap<number, string>;
  readonly halls: ReadonlyMap<number, string>;
  readonly movies: ReadonlyMap<number, string>;
}

// --- Alerts (U17) ---------------------------------------------------------------------------

/** A showtime later today with its sold seats, for `low-sales`. */
export interface LowSalesRow {
  readonly showtime_id: number;
  readonly starts_at: Date;
  readonly seat_capacity: number;
  readonly theater_id: number;
  readonly theater_name: string;
  readonly hall_id: number;
  readonly hall_name: string;
  readonly movie_id: number;
  readonly movie_title: string;
  readonly tickets: number;
}

/** An active hall of an active theater with no scheduled showtime on a cinema date. */
export interface HallGapRow {
  readonly hall_id: number;
  readonly hall_name: string;
  readonly theater_id: number;
  readonly theater_name: string;
  readonly cinema_date: CalendarDate;
}

/** A key a staff member has seen, and when first. */
export interface AlertReadRow {
  readonly alert_key: string;
  readonly seen_at: Date;
}

/** `failed-payments`: online charges declined or closed at the wallet today. */
export interface FailedPaymentsFacts {
  readonly count: number;
}

/** `low-sales`: a showtime later today under the threshold. */
export interface LowSalesFacts {
  readonly showtimeId: number;
  readonly startsAt: Date;
  readonly movie: NamedRef;
  readonly theater: TheaterRef;
  readonly hall: NamedRef;
  readonly ticketsSold: number;
  readonly seatCapacity: number;
  readonly soldShare: number;
}

/** `hall-gap`: an active hall with no showtime on an open cinema day. */
export interface HallGapFacts {
  readonly hall: NamedRef;
  readonly theater: TheaterRef;
}

/** One current alert, with its stable key (design §13.3). Exactly one facts field is set. */
export interface Alert {
  readonly key: string;
  readonly kind: AlertKind;
  /** The cinema day the alert is about. */
  readonly cinemaDate: CalendarDate;
  readonly title: string;
  readonly failedPayments: FailedPaymentsFacts | null;
  readonly lowSales: LowSalesFacts | null;
  readonly hallGap: HallGapFacts | null;
}

/** An alert as one staff member sees it. */
export interface StaffAlert extends Alert {
  readonly read: boolean;
  readonly readAt: Date | null;
}

/** `GET /admin/alerts`: one page of the caller's alerts, unread first, with the bell's count. */
export interface AlertPage extends Page<StaffAlert> {
  readonly unreadCount: number;
  readonly cinemaDate: CalendarDate;
  readonly serverTime: Date;
}

/** `POST /admin/alert-reads`: what was marked and the bell's state after it. */
export interface AlertReadResult {
  readonly markedCount: number;
  readonly unreadCount: number;
  readonly total: number;
}
