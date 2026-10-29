import type { ActorKind, AuditActor, AuditMetadataValue } from '../../common/audit/types';
import type { Currency, Money } from '../../common/money/types';
import type { Page } from '../../common/pagination/types';
import type { CalendarDate } from '../../common/time/types';
import type { AgeRating, MovieStatus } from '../catalog/types';
import type { Customer, CustomerStatus } from '../customers/types';
import type { HallLayout, HallSeat, HallStatus, Zone } from '../halls/types';
import type { StoredImage } from '../media/types';
import type {
  CounterPaymentMethod,
  LedgerEntry,
  OnlinePaymentMethod,
  Payment,
  PaymentMethod,
  PaymentStatus,
  SimulatedPaymentToken,
} from '../payments/types';
import type { ReleasedClaims, SeatSnapshot, ShowtimeSeats } from '../seating/types';
import type { ShowtimeStatus, ShowtimeView } from '../showtimes/types';
import type { StaffMember } from '../staff/types';
import type { TheaterStatus, ZonePrices } from '../theaters/types';
import type {
  AUTOMATIC_REFUND_REASONS,
  BOOKING_CHANNELS,
  BOOKING_DISPLAY_STATUSES,
  BOOKING_HISTORY_KINDS,
  BOOKING_STATUSES,
  COUNTER_CUSTOMER_KINDS,
  EDIT_DIRECTIONS,
  EDIT_REASONS,
  EDITED_FIELDS,
  HOLD_OWNERS,
  MY_BOOKINGS_TABS,
  NOT_BOOKABLE_REASONS,
  NOT_EDITABLE_REASONS,
  PAYMENT_STATUS_DISPLAYS,
  RELEASE_REASONS,
  SCAN_REASONS,
  SCAN_RESULTS,
  SCAN_VIA,
  STAFF_TICKET_CHANNELS,
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

export type {
  SettleFirstKind,
  SettleFirstOptions,
  SettleFirstSource,
} from '../../common/settlement/types';

export type CounterCustomerKind = (typeof COUNTER_CUSTOMER_KINDS)[number];

export type ScanResult = (typeof SCAN_RESULTS)[number];

export type ScanReason = (typeof SCAN_REASONS)[number];

export type ScanVia = (typeof SCAN_VIA)[number];

export type TicketStatus = (typeof TICKET_STATUSES)[number];

export type AutomaticRefundReason = (typeof AUTOMATIC_REFUND_REASONS)[number];

export type MyBookingsTab = (typeof MY_BOOKINGS_TABS)[number];

export type BookingHistoryKind = (typeof BOOKING_HISTORY_KINDS)[number];

export type TicketDeliveryChannel = (typeof TICKET_DELIVERY_CHANNELS)[number];

export type EditReason = (typeof EDIT_REASONS)[number];

export type EditDirection = (typeof EDIT_DIRECTIONS)[number];

export type NotEditableReason = (typeof NOT_EDITABLE_REASONS)[number];

export type EditedField = (typeof EDITED_FIELDS)[number];

export type StaffTicketChannel = (typeof STAFF_TICKET_CHANNELS)[number];

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

/** The booking a scan admits, as the scan judged it: on this showtime, of this QR version. */
export interface CheckInTarget {
  readonly id: number;
  readonly showtimeId: number;
  /** The presented QR code's version; null for a typed reference. */
  readonly qrVersion: number | null;
}

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

// --- Admin bookings (U14) -------------------------------------------------------------------

/** `GET /admin/bookings`, as validated (PRD A6 search and filters). */
export interface AdminBookingFilter {
  /** 2 to 100 characters, trimmed: a reference, or part of a contact name, email or phone. */
  readonly q?: string;
  readonly theaterId?: number;
  readonly movieId?: number;
  readonly status?: BookingDisplayStatus;
  readonly channel?: BookingChannel;
  /** A sale charge of this method exists. */
  readonly method?: PaymentMethod;
  /** The booking was made from 06:00 Cairo time on this cinema date… */
  readonly dateFrom?: CalendarDate;
  /** …until 06:00 after this one (inclusive cinema dates). */
  readonly dateTo?: CalendarDate;
}

/** What an admin search looks for: one reference exactly, or a substring of the contact fields. */
export type AdminBookingSearch =
  | { readonly kind: 'reference'; readonly reference: string }
  | {
      readonly kind: 'contact';
      /** The `ILIKE` pattern, `%`, `_` and `\\` escaped. */
      readonly pattern: string;
      /** The E.164 form of an Egyptian mobile typed locally (`01012345678`), also searched. */
      readonly phonePattern: string | null;
    };

/** One SQL condition of the admin list, on `bookings b` joined to `showtimes s`. */
export interface AdminSqlCondition {
  readonly sql: string;
  readonly bindings: readonly (string | number | Date)[];
}

/** A staff member as the admin screens name them. */
export interface StaffRef {
  readonly id: number;
  readonly fullName: string;
}

/** The customer card of the admin booking detail (PRD A6): null fields once anonymised. */
export interface AdminCustomerCard {
  readonly id: number;
  readonly fullName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly status: CustomerStatus;
  readonly anonymised: boolean;
}

/** A payment or refund as the admin detail shows it, with the staff it names. */
export interface AdminLedgerEntry {
  readonly entry: LedgerEntry;
  readonly collectedBy: StaffRef | null;
  readonly paidOutBy: StaffRef | null;
}

/** One event of a booking's activity log as staff read it (PRD A6 "Activity log"). */
export interface AdminActivityEvent {
  readonly action: string;
  readonly occurredAt: Date;
  readonly actorKind: ActorKind;
  /** The staff member who acted; null for a customer or the system. */
  readonly staff: StaffRef | null;
  readonly changedFields: readonly string[];
  readonly metadata: Readonly<Record<string, AuditMetadataValue>>;
}

/** What an admin may do with a booking now. */
export interface AdminBookingActions {
  readonly refund: boolean;
  readonly edit: boolean;
  readonly resendTickets: boolean;
}

/** `GET /admin/bookings/{ref}`: the booking and everything the admin detail shows. */
export interface AdminBookingDetail {
  readonly booking: Booking;
  readonly contact: BookingContact;
  readonly customer: AdminCustomerCard | null;
  /** The box office member who made a counter booking; null online. */
  readonly soldBy: StaffRef | null;
  readonly checkedInAt: Date | null;
  readonly checkedInBy: StaffRef | null;
  readonly ledger: readonly AdminLedgerEntry[];
  /** What a cancel and refund would give back now: the succeeded charges' remaining amounts. */
  readonly refundable: Money;
  readonly actions: AdminBookingActions;
  readonly activity: readonly AdminActivityEvent[];
}

/** The four cards of the admin bookings page (PRD A6), at `serverTime`. */
export interface AdminBookingSummary {
  readonly cinemaDate: CalendarDate;
  readonly serverTime: Date;
  /** Bookings made today that were paid (stored `confirmed` or `refunded`). */
  readonly todayBookings: number;
  /** Money taken today minus refunds paid out today. */
  readonly collectedToday: Money;
  /** Online payments declined today. */
  readonly failedPaymentsToday: number;
  /** Bookings refunded in the last 7 days and the money their cancellations gave back. */
  readonly refundedLast7Days: { readonly bookingCount: number; readonly amount: Money };
}

/** A `booking_notes` row (design §6.2). */
export interface BookingNoteRow {
  readonly id: number;
  readonly booking_id: number;
  readonly staff_user_id: number;
  readonly body: string;
  readonly created_at: Date;
}

/** A new note row. */
export type NewBookingNoteRow = Omit<BookingNoteRow, 'id'>;

/** An internal note as staff read it, with its author. */
export interface BookingNote {
  readonly id: number;
  readonly body: string;
  readonly author: StaffRef | null;
  readonly createdAt: Date;
}

/** What a staff resend queued: the channels and when. */
export interface StaffTicketDelivery {
  readonly channels: readonly StaffTicketChannel[];
  readonly queuedAt: Date;
}

/** Who and what a refund of locked bookings is for (cancel and refund, a showtime cancellation). */
export interface RefundContext {
  readonly actor: AuditActor;
  readonly now: Date;
  /** Why, as the `booking.refunded` audit event names it. */
  readonly reason: 'admin_cancel' | 'showtime_cancelled';
  /** Queue the "cancelled and refunded" email (cancel and refund); a showtime sends its own. */
  readonly notify: boolean;
}

/** One booking a refund changed: its row as locked, its refunds and the seats it freed. */
export interface RefundedBooking {
  readonly row: BookingRow;
  readonly refunds: readonly LedgerEntry[];
}

/** What cancel and refund answers: the refunds made and the booking after them. */
export interface BookingRefundResult {
  readonly refunds: readonly LedgerEntry[];
  readonly booking: Booking;
}

/** A contact change of an edit: each field changes when present (null clears it). */
export interface ContactChanges {
  readonly name?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
}

/** `POST /admin/bookings/{ref}/edit-previews` and `/edits`, as validated. */
export interface EditBookingInput {
  readonly showtimeId?: number;
  /** 1 to 8 distinct labels; the current seats when absent. */
  readonly seats?: readonly string[];
  readonly contact?: ContactChanges;
  readonly reason: EditReason;
  readonly notify: boolean;
  /** Required exactly when the total goes up: the difference taken at the counter. */
  readonly payment?: {
    readonly method: CounterPaymentMethod;
    readonly receiptReference: string | null;
  };
}

/** A seat of an edit's proposal: priced, and whether it is a seat the booking keeps. */
export interface PlannedSeat extends BookingSeat {
  readonly kept: boolean;
}

/** One refund of an edit's lower total: this much of this charge. */
export interface PlannedRefund {
  readonly charge: LedgerEntry;
  readonly amount: Money;
}

/** An edit's money: what moves and in which direction (the amount is never negative). */
export interface EditDifference {
  readonly direction: EditDirection;
  readonly amount: Money;
}

/** What `planEdit()` decides from, all read by the caller. */
export interface EditPlanInput {
  readonly row: BookingRow;
  readonly currentSeats: readonly BookingSeatRow[];
  readonly target: {
    readonly showtimeId: number;
    readonly prices: ZonePrices;
    /** The target hall's seats by label. */
    readonly layout: ReadonlyMap<string, HallSeat>;
  };
  /** The requested labels; the current ones when the edit names none. */
  readonly labels: readonly string[];
  readonly contact: ContactChanges | undefined;
  /** The booking's ledger, read under its lock for an edit. */
  readonly ledger: readonly LedgerEntry[];
}

/** An edit as it will be applied: the same for the preview and for the edit itself. */
export interface EditPlan {
  readonly seats: readonly PlannedSeat[];
  readonly previousTotal: Money;
  readonly total: Money;
  readonly difference: EditDifference;
  readonly refunds: readonly PlannedRefund[];
  readonly changedFields: readonly EditedField[];
  readonly contact: BookingContact;
  readonly showtimeChanged: boolean;
  readonly seatsChanged: boolean;
}

/** `POST /admin/bookings/{ref}/edit-previews`: the edit before and after, nothing saved. */
export interface EditPreview {
  readonly current: {
    readonly showtime: BookingShowtime;
    readonly seats: readonly BookingSeat[];
    readonly total: Money;
  };
  readonly proposed: {
    readonly showtime: BookingShowtime;
    readonly seats: readonly PlannedSeat[];
    readonly total: Money;
  };
  readonly difference: EditDifference;
  readonly refunds: readonly PlannedRefund[];
  readonly changedFields: readonly EditedField[];
  /** Target seats someone else holds or bought right now: the edit would be `SEAT_TAKEN`. */
  readonly unavailableSeats: readonly string[];
}

/** What an edit answers: the booking after it, its money and the payments it wrote. */
export interface EditResult {
  readonly booking: Booking;
  readonly difference: EditDifference;
  readonly changedFields: readonly EditedField[];
  readonly payments: readonly LedgerEntry[];
}

/** What an edit writes onto the booking row. */
export interface EditedBookingColumns {
  readonly showtime_id: number;
  readonly seat_count: number;
  readonly total_amount: number;
  readonly contact_name: string | null;
  readonly contact_email: string | null;
  readonly contact_phone: string | null;
  readonly updated_at: Date;
}

/** `GET /admin/showtimes/{id}/cancellation-preview` (PRD A5 "Cancel shows its impact"). */
export interface ShowtimeCancellationPreview {
  readonly showtimeId: number;
  /** Scheduled and not ended: `PATCH /admin/showtimes/{id}` would cancel it. */
  readonly cancellable: boolean;
  readonly bookingCount: number;
  readonly seatCount: number;
  /** Given back through the payment provider to cards and wallets. */
  readonly refundedOnline: Money;
  /** Owed back at the counter in cash or to the card terminal, pending until paid out. */
  readonly owedAtCounter: Money;
  readonly liveHoldCount: number;
  readonly emailCount: number;
  readonly smsCount: number;
}

/** The seats an edit frees on its old showtime and sells on its target, for the seat map. */
export interface EditSeatEvents {
  readonly released: ShowtimeSeats;
  readonly booked: ShowtimeSeats;
}

/** A booking's refunds as messages show them: the whole, and its online and counter parts. */
export interface RefundSplit {
  /** `formatMoneyDisplay` of the whole refund. */
  readonly amount: string;
  /** The part given back to the card or wallet, or null. */
  readonly onlineAmount: string | null;
  /** The part to collect at the box office, or null. */
  readonly counterAmount: string | null;
}

/** The parameters of the "booking cancelled and refunded" email (PRD "Email and SMS"). */
export interface BookingRefundedParams {
  readonly reference: string;
  readonly customerName: string | null;
  readonly movieTitle: string;
  readonly theaterName: string;
  /** `formatCairoDisplay`. */
  readonly startsAt: string;
  /** `formatMoneyDisplay` of the whole refund. */
  readonly amount: string;
  /** The part given back to the card or wallet, or null. */
  readonly onlineAmount: string | null;
  /** The part to collect at the box office, or null. */
  readonly counterAmount: string | null;
}

/** The parameters of the "showtime cancelled" email and SMS (PRD "Email and SMS"). */
export interface ShowtimeCancelledParams {
  readonly reference: string;
  readonly customerName: string | null;
  readonly movieTitle: string;
  readonly theaterName: string;
  readonly hallName: string;
  readonly startsAt: string;
  readonly amount: string;
  readonly onlineAmount: string | null;
  readonly counterAmount: string | null;
}

/** One row of the admin bookings list: the booking, its contact and its check-in. */
export interface AdminBookingListItem {
  readonly booking: Booking;
  readonly contact: BookingContact;
  readonly checkedInAt: Date | null;
}
