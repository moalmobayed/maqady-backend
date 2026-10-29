import type { AuditActor } from '../../common/audit/types';
import type { Currency, Money } from '../../common/money/types';
import type { Page } from '../../common/pagination/types';
import type { CalendarDate } from '../../common/time/types';
import type { AgeRating, MovieStatus } from '../catalog/types';
import type { HallLayout, HallStatus, Zone } from '../halls/types';
import type { StoredImage } from '../media/types';
import type {
  OnlinePaymentMethod,
  Payment,
  PaymentStatus,
  SimulatedPaymentToken,
} from '../payments/types';
import type { ReleasedClaims, SeatSnapshot } from '../seating/types';
import type { ShowtimeStatus, ShowtimeView } from '../showtimes/types';
import type { TheaterStatus, ZonePrices } from '../theaters/types';
import type {
  AUTOMATIC_REFUND_REASONS,
  BOOKING_CHANNELS,
  BOOKING_DISPLAY_STATUSES,
  BOOKING_HISTORY_KINDS,
  BOOKING_STATUSES,
  HOLD_OWNERS,
  MY_BOOKINGS_TABS,
  NOT_BOOKABLE_REASONS,
  PAYMENT_STATUS_DISPLAYS,
  RELEASE_REASONS,
  SETTLE_FIRST_KINDS,
  TICKET_DELIVERY_CHANNELS,
  TICKET_STATUSES,
} from './enums';

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export type BookingDisplayStatus = (typeof BOOKING_DISPLAY_STATUSES)[number];

export type BookingChannel = (typeof BOOKING_CHANNELS)[number];

export type HoldOwner = (typeof HOLD_OWNERS)[number];

export type NotBookableReason = (typeof NOT_BOOKABLE_REASONS)[number];

export type ReleaseReason = (typeof RELEASE_REASONS)[number];

export type PaymentStatusDisplay = (typeof PAYMENT_STATUS_DISPLAYS)[number];

export type SettleFirstKind = (typeof SETTLE_FIRST_KINDS)[number];

export type TicketStatus = (typeof TICKET_STATUSES)[number];

export type AutomaticRefundReason = (typeof AUTOMATIC_REFUND_REASONS)[number];

export type MyBookingsTab = (typeof MY_BOOKINGS_TABS)[number];

export type BookingHistoryKind = (typeof BOOKING_HISTORY_KINDS)[number];

export type TicketDeliveryChannel = (typeof TICKET_DELIVERY_CHANNELS)[number];

// --- Rows -----------------------------------------------------------------------------------

/** A `bookings` row as the repository reads it (the check-in columns come with U13). */
export interface BookingRow {
  readonly id: number;
  readonly reference: string;
  readonly showtime_id: number;
  readonly status: BookingStatus;
  readonly channel: BookingChannel;
  readonly customer_id: number | null;
  readonly created_by_staff_id: number | null;
  readonly hold_token_hash: string | null;
  readonly hold_expires_at: Date;
  readonly has_declined_payment: boolean;
  readonly seat_count: number;
  readonly total_amount: number;
  readonly currency: Currency;
  readonly contact_name: string | null;
  readonly contact_email: string | null;
  readonly contact_phone: string | null;
  readonly confirmed_at: Date | null;
  readonly refunded_at: Date | null;
  /** Set to 1 on confirmation; an edit (U14) increments it, which voids the older QR codes. */
  readonly qr_version: number | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** The columns of a new online hold. */
export interface NewBookingRow {
  readonly showtime_id: number;
  readonly status: 'held';
  readonly channel: 'online';
  readonly customer_id: number | null;
  readonly created_by_staff_id: null;
  readonly hold_token_hash: string | null;
  readonly hold_expires_at: Date;
  readonly has_declined_payment: false;
  readonly seat_count: number;
  readonly total_amount: number;
  readonly currency: Currency;
  readonly contact_name: string | null;
  readonly contact_email: string | null;
  readonly contact_phone: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** A `booking_seats` row: one seat of a booking and the price it was held at. */
export interface BookingSeatRow {
  readonly booking_id: number;
  readonly seat_label: string;
  readonly row_label: string;
  readonly seat_number: number;
  readonly zone: Zone;
  readonly price: number;
  readonly is_wheelchair: boolean;
}

/** What claiming a hold writes onto the booking: its new owner and their contact. */
export interface BookingOwnerColumns {
  readonly customer_id: number;
  readonly hold_token_hash: null;
  readonly contact_name: string | null;
  readonly contact_email: string | null;
  readonly contact_phone: string | null;
  readonly updated_at: Date;
}

// --- Status ---------------------------------------------------------------------------------

/** What the clock-derived status of a booking is decided from (design §7.4). */
export interface BookingStatusInput {
  readonly status: BookingStatus;
  readonly holdExpiresAt: Date;
  readonly hasDeclinedPayment: boolean;
  /** The showtime's end: a confirmed booking is Completed from then on. */
  readonly showtimeEndsAt: Date;
}

/** A SQL condition with its bindings, for a repository's `whereRaw`. */
export interface SqlPredicate {
  readonly sql: string;
  readonly bindings: readonly Date[];
}

/** The table aliases a status predicate is written against. */
export interface StatusAliases {
  /** The `bookings` alias. */
  readonly booking: string;
  /** The `showtimes` alias (confirmed and completed compare its `ends_at`). */
  readonly showtime: string;
}

/** What decides whether a showtime can be held now (design §7.3 steps 2–3). */
export interface BookabilityInput {
  readonly showtimeStatus: ShowtimeStatus;
  readonly startsAt: Date;
  readonly theaterStatus: TheaterStatus;
  readonly movieStatus: MovieStatus;
  readonly hallStatus: HallStatus;
}

// --- Holds ----------------------------------------------------------------------------------

/** Who asks for a hold: a guest, or a signed-in customer; either may present an earlier code. */
export type HoldHolder =
  | { readonly kind: 'guest'; readonly holdCode?: string }
  | { readonly kind: 'customer'; readonly customerId: number; readonly holdCode?: string };

/** `POST /showtimes/{id}/holds`, as validated. */
export interface CreateHoldInput {
  readonly showtimeId: number;
  /** 1 to 8 distinct seat labels. */
  readonly labels: readonly string[];
  readonly holder: HoldHolder;
}

/**
 * What a caller proves about a booking: the signed-in customer, and the hold code from
 * `X-Hold-Token`. Either may be absent.
 */
export interface HoldAccess {
  readonly customerId?: number;
  readonly holdCode?: string;
}

/** A new hold code: the code, returned once, and its SHA-256, which is all that is stored. */
export interface NewHoldCode {
  readonly code: string;
  readonly hash: string;
}

/** A customer's contact, copied onto a booking they hold. */
export interface BookingContact {
  readonly name: string | null;
  readonly email: string | null;
  readonly phone: string | null;
}

/** A stored hold's status and end, as `isLiveHold()` reads them. */
export type HoldTiming = Pick<BookingStatusInput, 'status' | 'holdExpiresAt'>;

/** The live holds a new hold replaces, locked, and their claims to free. */
export interface HoldsToRelease {
  readonly rows: BookingRow[];
  readonly claims: ReleasedClaims[];
}

/** A hold just inserted: its row and its priced seats. */
export interface InsertedHold {
  readonly row: BookingRow;
  readonly seats: BookingSeatRow[];
}

/** The seats a new hold claims on its showtime: not announced as released by the hold it replaced. */
export interface ReclaimedSeats {
  readonly showtimeId: number;
  readonly labels: readonly string[];
}

/** An audit event of a booking, as the holds service records it. */
export interface BookingAuditEvent {
  readonly actor: AuditActor;
  readonly action: 'booking.held' | 'booking.claimed' | 'booking.released';
  readonly bookingId: number;
  readonly metadata: Readonly<Record<string, string | number>>;
}

// --- Reads ----------------------------------------------------------------------------------

/** One seat of a booking, with the price it was held at. */
export interface BookingSeat {
  readonly label: string;
  readonly rowLabel: string;
  readonly seatNumber: number;
  readonly zone: Zone;
  readonly price: Money;
  readonly isWheelchair: boolean;
}

/** A movie as a booking and the seat page show it. */
export interface BookingMovie {
  readonly id: number;
  readonly title: string;
  readonly ageRating: AgeRating;
  readonly runtimeMinutes: number | null;
  readonly poster: StoredImage | null;
}

/** A theater or hall as a booking names it. */
export interface NamedRef {
  readonly id: number;
  readonly name: string;
}

/** A theater as a booking names it, with where it is for "Directions" (PRD C9, C11). */
export interface BookingTheater extends NamedRef {
  readonly address: string;
  readonly district: string;
  readonly city: string;
  readonly latitude: number;
  readonly longitude: number;
}

/** The showtime header of a booking and of the seat page (PRD C6): movie, theater, hall, time. */
export interface BookingShowtime {
  readonly id: number;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly cinemaDate: CalendarDate;
  readonly movie: BookingMovie;
  readonly theater: BookingTheater;
  readonly hall: NamedRef;
}

/**
 * One line of a booking's payment table (PRD C8, C11): the seats of one zone at one price,
 * "Middle · F7, F8 · 2 × EGP 190".
 */
export interface SeatLine {
  readonly zone: Zone;
  /** In seat order: row, then number (`F2` before `F10`). */
  readonly labels: readonly string[];
  readonly count: number;
  readonly unitPrice: Money;
  /** `count × unitPrice`. */
  readonly amount: Money;
}

/** A refunded booking's refund (PRD C11 "the refund amount and date"): always the full total. */
export interface BookingRefund {
  readonly amount: Money;
  readonly refundedAt: Date;
}

/** A confirmed booking's ticket: the signed QR payload and how many people it admits. */
export interface BookingTicket {
  readonly qrCode: string;
  readonly admits: number;
}

/** A booking as the API shows it, its status decided at `serverTime`. */
export interface Booking {
  readonly id: number;
  readonly reference: string;
  readonly status: BookingDisplayStatus;
  readonly channel: BookingChannel;
  readonly owner: HoldOwner;
  readonly customerId: number | null;
  readonly showtime: BookingShowtime;
  /** In label order. */
  readonly seats: readonly BookingSeat[];
  readonly seatCount: number;
  readonly total: Money;
  readonly holdExpiresAt: Date;
  readonly serverTime: Date;
  readonly createdAt: Date;
  readonly confirmedAt: Date | null;
  /** Decided with `status` (design §7.4). */
  readonly paymentStatus: PaymentStatusDisplay;
  /** The latest online or counter sale charge, if any. */
  readonly payment: Payment | null;
  /** Set while the booking is confirmed or completed. */
  readonly ticket: BookingTicket | null;
  /** The seats by zone and price, zones front to back (U12). */
  readonly seatLines: readonly SeatLine[];
  /** Set for a refunded booking (U12). */
  readonly refund: BookingRefund | null;
}

/** A hold just created: the booking, and the guest's hold code (null for a customer). */
export interface CreatedHold {
  readonly booking: Booking;
  readonly holdCode: string | null;
}

/** `GET /showtimes/{id}`: the header, the hall's layout, the prices and whether it can be held. */
export interface ShowtimeSeatMap {
  readonly showtime: BookingShowtime;
  readonly prices: ZonePrices;
  readonly fromPrice: Money;
  readonly seatCapacity: number;
  readonly layout: HallLayout;
  readonly bookable: boolean;
  readonly notBookableReason: NotBookableReason | null;
}

/** `GET /showtimes/{id}/seats`: the taken seats and how many are left. */
export interface SeatMapAvailability {
  readonly snapshot: SeatSnapshot;
  readonly availableCount: number;
  readonly soldOut: boolean;
}

/**
 * A showtime with what decides whether it can be held and what its header shows, read in a
 * fixed number of queries.
 */
export interface ShowtimeContext {
  readonly view: ShowtimeView;
  readonly theaterStatus: TheaterStatus;
  readonly movieStatus: MovieStatus;
  readonly header: BookingShowtime;
}

/** Everything a booking response is assembled from, in a fixed number of queries. */
export interface BookingParts {
  readonly row: BookingRow;
  readonly seats: readonly BookingSeatRow[];
  readonly showtime: BookingShowtime;
  /** The latest sale charge; null when there is none (a new hold). */
  readonly latestSale: Payment | null;
  /** The signed QR payload of a booking with a QR version; null otherwise. */
  readonly qrCode: string | null;
  readonly now: Date;
}

/** What a booking's payment status is decided from (design §7.4). */
export interface PaymentStatusInput {
  readonly status: BookingStatus;
  readonly hasDeclinedPayment: boolean;
  /** The latest sale charge's status, if the booking has one. */
  readonly latestSaleStatus: PaymentStatus | null;
}

// --- Checkout and settlement (U11) ----------------------------------------------------------

/** `POST /bookings/{ref}/payments`, as validated. */
export interface CheckoutInput {
  readonly reference: string;
  readonly customerId: number;
  readonly method: OnlinePaymentMethod;
  readonly token: SimulatedPaymentToken;
}

/** What a payment answers: the charge as recorded and the booking after it. */
export interface CheckoutResult {
  readonly payment: Payment;
  readonly booking: Booking;
}

/** A held booking to confirm, its row and claims already locked by the caller. */
export interface ConfirmBookingInput {
  readonly bookingId: number;
  readonly showtimeId: number;
  readonly channel: BookingChannel;
  /** Every seat of the booking. */
  readonly labels: readonly string[];
}

/**
 * Which due payments to settle: those of the booking with this reference, of bookings on this
 * showtime, or of this customer's bookings. At least one is given.
 */
export interface SettlementScope {
  readonly bookingReference?: string;
  readonly showtimeId?: number;
  readonly customerId?: number;
}

/** How many bookings one settlement confirmed, marked declined and refunded at once. */
export interface SettlementResult {
  readonly confirmed: number;
  readonly declined: number;
  readonly refunded: number;
}

/** A booking settlement refunds at once, and why. */
export interface AutomaticRefund {
  readonly row: BookingRow;
  readonly charge: Payment;
  readonly reason: AutomaticRefundReason;
}

/** The ticket holders of a showtime as the repository reads them: confirmed bookings' contacts. */
export interface TicketHolderRow {
  readonly id: number;
  readonly reference: string;
  readonly customer_id: number | null;
  readonly contact_email: string | null;
  readonly contact_phone: string | null;
}

// --- Tickets (U11) --------------------------------------------------------------------------

/** A QR payload's parts once its signature verified. */
export interface QrPayload {
  readonly reference: string;
  readonly version: number;
}

/** A QR payload taken apart, before its signature is checked. */
export interface ParsedQr extends QrPayload {
  readonly signature: string;
}

/** Who asks for a ticket file: the owning customer, or staff (U13's box office download). */
export type TicketAccess =
  { readonly kind: 'owner'; readonly customerId: number } | { readonly kind: 'staff' };

/** One seat as a ticket prints it. */
export interface TicketSeat {
  readonly label: string;
  readonly zone: Zone;
}

/** Everything a ticket shows: the PDF, the calendar file and the tickets messages. */
export interface TicketDetails {
  readonly bookingId: number;
  readonly reference: string;
  readonly customerId: number | null;
  readonly contactName: string | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly movieTitle: string;
  readonly ageRating: AgeRating;
  readonly theaterName: string;
  readonly theaterAddress: string;
  readonly theaterDistrict: string;
  readonly theaterCity: string;
  readonly hallName: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly cinemaDate: CalendarDate;
  /** In label order. */
  readonly seats: readonly TicketSeat[];
  readonly admits: number;
  readonly total: Money;
  readonly qrCode: string;
}

/** A file built on demand: the PDF ticket or the calendar file. */
export interface TicketFile {
  readonly filename: string;
  readonly contentType: string;
  readonly body: Buffer;
}

/**
 * Whether the tickets also go by SMS to a phone on file, and where the email goes: the booking's
 * contact email unless `emailTo` names another address ("Email again" sends to the account's own
 * email, U12; only for one booking at a time).
 */
export interface QueueTicketsOptions {
  readonly sms: boolean;
  readonly emailTo?: string;
}

/**
 * The parameters of the tickets email and SMS (PRD "Email and SMS": booking confirmed → tickets).
 * `qrCode` is secret: no stored copy may hold it, so the messages carry it only as a one-time
 * link that the storage render redacts.
 */
export interface BookingTicketsParams {
  readonly reference: string;
  readonly customerName: string | null;
  readonly movieTitle: string;
  readonly ageRating: string;
  readonly theaterName: string;
  readonly theaterAddress: string;
  readonly hallName: string;
  /** `formatCairoDisplay`, `Sun 11 Oct 2026, 19:30`. */
  readonly startsAt: string;
  /** `F7, F8`. */
  readonly seats: string;
  readonly admits: number;
  /** `formatMoneyDisplay`, `EGP 380`. */
  readonly total: string;
  readonly qrCode: string;
}

// --- Customer bookings (U12) ----------------------------------------------------------------

/** `GET /me/bookings`, as validated. */
export interface MyBookingsQueryInput {
  readonly tab: MyBookingsTab;
  readonly cursor?: string;
  readonly limit?: number;
}

/** How many bookings each tab of My Bookings has, for the tab labels. */
export type MyBookingsTabCounts = Readonly<Record<MyBookingsTab, number>>;

/** One page of a My Bookings tab, with both tabs' counts. */
export interface MyBookingsPage extends Page<Booking> {
  readonly tabCounts: MyBookingsTabCounts;
}

/** A booking of a My Bookings page: its row and its showtime's start, the keyset's sort key. */
export interface MyBookingRow extends BookingRow {
  readonly showtime_starts_at: Date;
}

/** One `COUNT(*) FILTER` row per customer: how many bookings each tab has. */
export interface TabCountsRow {
  readonly upcoming: number;
  readonly past: number;
}

/** One event of a booking's History (PRD C11): what happened and when, never who did it. */
export interface BookingHistoryEvent {
  readonly kind: BookingHistoryKind;
  readonly label: string;
  readonly occurredAt: Date;
}

/** An audit event as `toHistoryEvent()` reads it. */
export interface HistoryAuditEvent {
  readonly action: string;
  readonly occurredAt: Date;
}

/** What "Email again" answers: the tickets email is queued and leaves after commit. */
export interface TicketDelivery {
  readonly channel: TicketDeliveryChannel;
  readonly queuedAt: Date;
}
