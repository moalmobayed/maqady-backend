import type { AuditActor } from '../../common/audit/types';
import type { Currency, Money } from '../../common/money/types';
import type { CalendarDate } from '../../common/time/types';
import type { AgeRating, MovieStatus } from '../catalog/types';
import type { Customer } from '../customers/types';
import type { HallLayout, HallStatus, Zone } from '../halls/types';
import type { StoredImage } from '../media/types';
import type {
  CounterPaymentMethod,
  OnlinePaymentMethod,
  Payment,
  PaymentStatus,
  SimulatedPaymentToken,
} from '../payments/types';
import type { ReleasedClaims, SeatSnapshot } from '../seating/types';
import type { ShowtimeStatus, ShowtimeView } from '../showtimes/types';
import type { StaffMember } from '../staff/types';
import type { TheaterStatus, ZonePrices } from '../theaters/types';
import type {
  AUTOMATIC_REFUND_REASONS,
  BOOKING_CHANNELS,
  BOOKING_DISPLAY_STATUSES,
  BOOKING_STATUSES,
  COUNTER_CUSTOMER_KINDS,
  HOLD_OWNERS,
  NOT_BOOKABLE_REASONS,
  PAYMENT_STATUS_DISPLAYS,
  RELEASE_REASONS,
  SCAN_REASONS,
  SCAN_RESULTS,
  SCAN_VIA,
  SETTLE_FIRST_KINDS,
  SETTLE_FIRST_SOURCES,
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

export type SettleFirstSource = (typeof SETTLE_FIRST_SOURCES)[number];

export type CounterCustomerKind = (typeof COUNTER_CUSTOMER_KINDS)[number];

export type ScanResult = (typeof SCAN_RESULTS)[number];

export type ScanReason = (typeof SCAN_REASONS)[number];

export type ScanVia = (typeof SCAN_VIA)[number];

export type TicketStatus = (typeof TICKET_STATUSES)[number];

export type AutomaticRefundReason = (typeof AUTOMATIC_REFUND_REASONS)[number];

// --- Rows -----------------------------------------------------------------------------------

/** A `bookings` row as the repository reads it. */
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
  /** The first admission at the entrance and who scanned it (U13); null until then. */
  readonly checked_in_at: Date | null;
  readonly checked_in_by_staff_id: number | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** The columns of a new hold: online (a guest or a customer) or at the counter (U13). */
export interface NewBookingRow {
  readonly showtime_id: number;
  readonly status: 'held';
  readonly channel: BookingChannel;
  readonly customer_id: number | null;
  /** The box office member of a counter hold; null online. */
  readonly created_by_staff_id: number | null;
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

/**
 * Who asks for a hold: a guest, or a signed-in customer, either of whom may present an earlier
 * code; or a staff member at the counter (U13), whose hold has no code and no customer.
 */
export type HoldHolder =
  | { readonly kind: 'guest'; readonly holdCode?: string }
  | { readonly kind: 'customer'; readonly customerId: number; readonly holdCode?: string }
  | { readonly kind: 'staff'; readonly staffUserId: number };

/** `POST /showtimes/{id}/holds`, as validated. */
export interface CreateHoldInput {
  readonly showtimeId: number;
  /** 1 to 8 distinct seat labels. */
  readonly labels: readonly string[];
  readonly holder: HoldHolder;
}

/**
 * What a caller proves about a booking: the signed-in customer, and the hold code from
 * `X-Hold-Token`, or the staff member acting on their own counter hold (U13). Any may be absent.
 */
export interface HoldAccess {
  readonly customerId?: number;
  readonly holdCode?: string;
  readonly staffUserId?: number;
}

/** A new hold code: the code, returned once, and its SHA-256, which is all that is stored. */
export interface NewHoldCode {
  readonly code: string;
  readonly hash: string;
}

/**
 * Who a new hold's row is written for, locked by the caller: the customer, or the staff member of
 * a counter hold (U13), or neither (a guest, who gets the hold code).
 */
export interface HoldRowHolder {
  readonly customer: Customer | null;
  readonly member: StaffMember | null;
  readonly code: NewHoldCode | null;
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

/** The showtime header of a booking and of the seat page (PRD C6): movie, theater, hall, time. */
export interface BookingShowtime {
  readonly id: number;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly cinemaDate: CalendarDate;
  readonly movie: BookingMovie;
  readonly theater: NamedRef;
  readonly hall: NamedRef;
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

/** Whether the tickets of a confirmation also go by SMS to a phone on file. */
export interface QueueTicketsOptions {
  readonly sms: boolean;
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

// --- Box office (U13) -----------------------------------------------------------------------

/** `POST /admin/counter-holds`, as validated. */
export interface CounterHoldInput {
  readonly showtimeId: number;
  /** 1 to 8 distinct seat labels. */
  readonly labels: readonly string[];
}

/** Who a counter sale is for (PRD A6): a walk-in, an existing customer, or typed contact details. */
export type CounterCustomer =
  | { readonly kind: 'walk_in' }
  | { readonly kind: 'existing'; readonly customerId: number }
  | {
      readonly kind: 'contact';
      readonly fullName: string;
      readonly email: string | null;
      readonly phone: string | null;
    };

/** `POST /admin/bookings/{ref}/counter-payments`, as validated. */
export interface CounterPaymentInput {
  readonly method: CounterPaymentMethod;
  /** Required with `card_terminal`, null with `cash`. */
  readonly receiptReference: string | null;
  readonly customer: CounterCustomer;
}

/** What a counter sale writes onto the booking it confirms: its customer and contact, if any. */
export interface CounterCustomerColumns {
  readonly customer_id: number | null;
  readonly contact_name: string | null;
  readonly contact_email: string | null;
  readonly contact_phone: string | null;
  readonly updated_at: Date;
}

/** `POST /admin/scans`, as validated: a QR payload, or a typed reference with its confirmation. */
export type ScanInput =
  | { readonly theaterId: number; readonly via: 'qr'; readonly code: string }
  | {
      readonly theaterId: number;
      readonly via: 'reference';
      readonly reference: string;
      readonly confirm: boolean;
    };

/** What a scan's verdict is decided from, read at the scan (design §7.9). */
export interface ScanVerdictInput {
  /** The theater the scanner stands in. */
  readonly theaterId: number;
  readonly showtime: {
    readonly theaterId: number;
    readonly status: ShowtimeStatus;
    readonly startsAt: Date;
    readonly endsAt: Date;
  };
  readonly booking: {
    readonly status: BookingStatus;
    readonly qrVersion: number | null;
    readonly checkedInAt: Date | null;
  };
  /** The QR code's version; null for a typed reference. */
  readonly presentedVersion: number | null;
  readonly via: ScanVia;
  /** A typed reference's second request (`confirm: true`); ignored for a QR code. */
  readonly confirm: boolean;
}

/** A scan's verdict: admit the booking now, or answer this result and reason. */
export type ScanVerdict =
  | { readonly admit: true }
  | { readonly admit: false; readonly result: ScanResult; readonly reason: ScanReason | null };

/** The booking a scan found, as the scanner screen shows it. */
export interface ScannedBooking {
  readonly reference: string;
  readonly status: BookingDisplayStatus;
  /** In label order. */
  readonly seats: readonly string[];
  readonly seatCount: number;
  readonly contactName: string | null;
  readonly showtime: BookingShowtime;
}

/** What a scan answers (design §7.9): every outcome is a result, never an error. */
export interface ScanOutcome {
  readonly result: ScanResult;
  readonly reason: ScanReason | null;
  /** The seats it admits, for `VALID`, `ALREADY_USED` and `CONFIRM_REQUIRED`; null otherwise. */
  readonly admits: number | null;
  /** When it was admitted: now for `VALID`, the first scan for `ALREADY_USED`; null otherwise. */
  readonly checkedInAt: Date | null;
  readonly scannedAt: Date;
  /** Null for `NOT_FOUND`. */
  readonly booking: ScannedBooking | null;
}

/** `@SettleFirst()`'s metadata: what to settle, and where the route names it. */
export interface SettleFirstOptions {
  readonly kind: SettleFirstKind;
  readonly source: SettleFirstSource;
}
