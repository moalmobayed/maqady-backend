import type { AuditActor } from '../../common/audit/types';
import type { Currency, Money } from '../../common/money/types';
import type { CalendarDate } from '../../common/time/types';
import type { AgeRating, MovieStatus } from '../catalog/types';
import type { HallLayout, HallStatus, Zone } from '../halls/types';
import type { StoredImage } from '../media/types';
import type { ReleasedClaims, SeatSnapshot } from '../seating/types';
import type { ShowtimeStatus, ShowtimeView } from '../showtimes/types';
import type { TheaterStatus, ZonePrices } from '../theaters/types';
import type {
  BOOKING_CHANNELS,
  BOOKING_DISPLAY_STATUSES,
  BOOKING_STATUSES,
  HOLD_OWNERS,
  NOT_BOOKABLE_REASONS,
  RELEASE_REASONS,
} from './enums';

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export type BookingDisplayStatus = (typeof BOOKING_DISPLAY_STATUSES)[number];

export type BookingChannel = (typeof BOOKING_CHANNELS)[number];

export type HoldOwner = (typeof HOLD_OWNERS)[number];

export type NotBookableReason = (typeof NOT_BOOKABLE_REASONS)[number];

export type ReleaseReason = (typeof RELEASE_REASONS)[number];

// --- Rows -----------------------------------------------------------------------------------

/** A `bookings` row as the repository reads it (the check-in and QR columns come with U11/U13). */
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

/** Everything a booking response is assembled from, in two or three fixed queries. */
export interface BookingParts {
  readonly row: BookingRow;
  readonly seats: readonly BookingSeatRow[];
  readonly showtime: BookingShowtime;
  readonly now: Date;
}
