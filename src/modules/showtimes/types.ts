import type { AuditMetadataValue } from '../../common/audit/types';
import type { StaffPrincipal } from '../../common/auth/types';
import type { Currency, Money } from '../../common/money/types';
import type { CalendarDate } from '../../common/time/types';
import type { MovieRef, MovieSchedulingInfo } from '../catalog/types';
import type { HallSummary } from '../halls/types';
import type { OpeningWindow, TheaterStatus, TheaterSummary, ZonePrices } from '../theaters/types';
import type {
  BATCH_RESULTS,
  CANCEL_REASONS,
  CHECK_RESULTS,
  NOT_EDITABLE_REASONS,
  NOT_SCHEDULABLE_REASONS,
  SHOWTIME_STATUSES,
} from './enums';

export type ShowtimeStatus = (typeof SHOWTIME_STATUSES)[number];

export type CancelReason = (typeof CANCEL_REASONS)[number];

export type CheckResult = (typeof CHECK_RESULTS)[number];

export type BatchResult = (typeof BATCH_RESULTS)[number];

export type NotSchedulableReason = (typeof NOT_SCHEDULABLE_REASONS)[number];

export type NotEditableReason = (typeof NOT_EDITABLE_REASONS)[number];

// --- Rows -----------------------------------------------------------------------------------

/** A `showtimes` row as the repository reads it. `cinema_date` stays `YYYY-MM-DD` (U1's parser). */
export interface ShowtimeRow {
  readonly id: number;
  readonly movie_id: number;
  readonly theater_id: number;
  readonly hall_id: number;
  readonly starts_at: Date;
  readonly ends_at: Date;
  readonly cleaning_ends_at: Date;
  readonly cinema_date: CalendarDate;
  readonly price_front: number;
  readonly price_middle: number;
  readonly price_back: number;
  readonly currency: Currency;
  readonly seat_capacity: number;
  readonly status: ShowtimeStatus;
  readonly cancel_reason: CancelReason | null;
  readonly cancelled_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** The columns of a new showtime: always scheduled. */
export interface NewShowtimeRow {
  readonly movie_id: number;
  readonly theater_id: number;
  readonly hall_id: number;
  readonly starts_at: Date;
  readonly ends_at: Date;
  readonly cleaning_ends_at: Date;
  readonly cinema_date: CalendarDate;
  readonly price_front: number;
  readonly price_middle: number;
  readonly price_back: number;
  readonly currency: Currency;
  readonly seat_capacity: number;
  readonly status: 'scheduled';
  readonly cancel_reason: null;
  readonly cancelled_at: null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** The columns a showtime write may change; `updated_at` always. */
export interface ShowtimeRowUpdate {
  readonly starts_at?: Date;
  readonly ends_at?: Date;
  readonly cleaning_ends_at?: Date;
  readonly cinema_date?: CalendarDate;
  readonly price_front?: number;
  readonly price_middle?: number;
  readonly price_back?: number;
  readonly currency?: Currency;
  readonly status?: ShowtimeStatus;
  readonly cancel_reason?: CancelReason;
  readonly cancelled_at?: Date;
  readonly updated_at: Date;
}

/** A scheduled showtime that occupies its hall, as the conflict queries read it. */
export interface BusySlotRow {
  readonly id: number;
  readonly movie_id: number;
  readonly starts_at: Date;
  readonly ends_at: Date;
  readonly cleaning_ends_at: Date;
}

// --- Time -----------------------------------------------------------------------------------

/** When a showtime starts, ends, and its hall is clean again (`ends_at` + 20 minutes). */
export interface ShowtimeSpan {
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly cleaningEndsAt: Date;
}

/** A scheduled showtime that occupies its hall from `startsAt` until `cleaningEndsAt`. */
export interface BusySlot extends ShowtimeSpan {
  readonly id: number;
  readonly movieId: number;
}

/** A free start the dry run suggests for a date that doesn't fit (design §8). */
export interface SuggestedStart {
  /** Cairo wall clock, `HH:mm`; `00:00`–`05:59` is the next calendar day. */
  readonly startTime: string;
  readonly startsAt: Date;
}

/** What `suggestStarts()` needs for one cinema date. */
export interface SuggestionInput {
  readonly cinemaDate: CalendarDate;
  /** The requested start time, `HH:mm`: suggestions nearest to it come first. */
  readonly requestedTime: string;
  readonly runtimeMinutes: number;
  readonly window: OpeningWindow | null;
  readonly busy: readonly BusySlot[];
  readonly now: Date;
}

// --- Scheduling -----------------------------------------------------------------------------

/** The movie, hall and theater a request schedules, as read (dry run) or locked (writes). */
export interface SchedulingTarget {
  readonly movie: MovieSchedulingInfo;
  readonly hall: HallSummary;
  readonly theater: TheaterSummary;
}

/** A showtime another one would come closer than 20 minutes to. */
export interface ShowtimeConflict extends ShowtimeSpan {
  readonly showtimeId: number;
  readonly movieTitle: string;
}

/** The checks of one requested cinema date. */
export interface DateCheck {
  readonly cinemaDate: CalendarDate;
  readonly result: CheckResult;
  /** Null when the start time doesn't exist that night. */
  readonly span: ShowtimeSpan | null;
  /** The date's opening window; null when closed or without hours. */
  readonly window: OpeningWindow | null;
  /** The showtimes it overlaps, cleaning included; empty unless `result` is `conflict`. */
  readonly conflicts: readonly ShowtimeConflict[];
  /** Free starts on the 5-minute grid; empty for an `available` date or without a dry run. */
  readonly suggestions: readonly SuggestedStart[];
}

/** What `checkDates()` is asked to do beyond the checks. */
export interface DateCheckOptions {
  readonly now: Date;
  /** Compute suggestions for the dates that don't fit (the dry run). */
  readonly withSuggestions: boolean;
}

/** `POST /admin/showtime-checks`, as validated. */
export interface ScheduleRequest {
  readonly movieId: number;
  readonly hallId: number;
  /** Cinema dates, unique; the service checks them in date order. */
  readonly dates: readonly CalendarDate[];
  /** `HH:mm`; `00:00`–`05:59` is on the calendar day after the cinema date. */
  readonly startTime: string;
}

/** `POST /admin/showtimes`, as validated. */
export interface CreateShowtimesInput extends ScheduleRequest {
  /** Overrides the theater's default prices for these showtimes. */
  readonly prices?: ZonePrices;
  /** True: create the dates that fit and skip the others. False: all of them or nothing. */
  readonly skipUnavailable: boolean;
}

/** A movie as the admin showtime responses show it. */
export interface ShowtimeMovie {
  readonly id: number;
  readonly title: string;
  readonly status: MovieRef['status'];
  readonly runtimeMinutes: number | null;
  readonly ageRating: MovieRef['ageRating'];
}

/** The dry run's answer. */
export interface ShowtimeCheckOutcome {
  readonly movie: ShowtimeMovie;
  readonly hall: HallRef;
  readonly theaterId: number;
  readonly startTime: string;
  readonly results: readonly DateCheck[];
}

/** One date of a batch create. */
export interface BatchItemResult {
  readonly cinemaDate: CalendarDate;
  readonly result: BatchResult;
  /** The created showtime; null unless `result` is `created`. */
  readonly showtime: AdminShowtime | null;
  readonly conflicts: readonly ShowtimeConflict[];
}

/** A batch create's answer: every date, in date order. */
export interface BatchOutcome {
  readonly results: readonly BatchItemResult[];
  readonly createdCount: number;
  readonly skippedCount: number;
}

/** `PATCH /admin/showtimes/{id}`, as validated: a move, prices, both, or a cancellation. */
export interface ShowtimeChanges {
  /** The new cinema date of a move; the current one when left out. */
  readonly cinemaDate?: CalendarDate;
  /** The new start time of a move, `HH:mm`. */
  readonly startTime?: string;
  readonly prices?: ZonePrices;
  readonly status?: 'cancelled';
  readonly cancelReason?: CancelReason;
}

// --- Reads ----------------------------------------------------------------------------------

/** A hall as a showtime names it. */
export interface HallRef {
  readonly id: number;
  readonly name: string;
}

/**
 * A showtime as other units read it (U8 discovery, U10 holds, U14 cancellation), in any status.
 * `fromPrice` is the cheapest zone price among the zones its hall's current layout has seats in
 * (design §7.10), computed at read.
 */
export interface ShowtimeView extends ShowtimeSpan {
  readonly id: number;
  readonly movieId: number;
  readonly theaterId: number;
  readonly hallId: number;
  readonly hallName: string;
  readonly cinemaDate: CalendarDate;
  readonly status: ShowtimeStatus;
  readonly cancelReason: CancelReason | null;
  readonly cancelledAt: Date | null;
  readonly prices: ZonePrices;
  readonly fromPrice: Money;
  readonly seatCapacity: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A showtime as the admin timeline and manage panel show it. */
export interface AdminShowtime extends ShowtimeView {
  readonly movie: ShowtimeMovie;
  /** Cairo wall clock of the start, `HH:mm`. */
  readonly startTime: string;
  readonly hasStarted: boolean;
  readonly hasEnded: boolean;
  /** Scheduled and not started: it can be moved and re-priced. */
  readonly movable: boolean;
  /** Scheduled and not ended: it can be cancelled. */
  readonly cancellable: boolean;
}

/** A theater as the admin showtime responses name it. */
export interface ShowtimeTheater {
  readonly id: number;
  readonly name: string;
  readonly status: TheaterStatus;
}

/** `GET /admin/showtimes/{id}`: the manage panel. */
export interface AdminShowtimeDetail extends AdminShowtime {
  readonly theater: ShowtimeTheater;
}

/** `GET /admin/showtimes` filters: one theater's cinema date. */
export interface TimelineFilter {
  readonly theaterId: number;
  readonly cinemaDate: CalendarDate;
  readonly hallId?: number;
  readonly status?: ShowtimeStatus;
}

/** A hall row of the timeline. */
export interface TimelineHall {
  readonly id: number;
  readonly name: string;
  readonly status: HallSummary['status'];
  readonly seatCount: number;
}

/** `GET /admin/showtimes`: one theater's cinema date, its window and halls, and a page. */
export interface ShowtimeTimeline {
  readonly theater: ShowtimeTheater;
  readonly cinemaDate: CalendarDate;
  readonly window: OpeningWindow | null;
  readonly specialDateLabel: string | null;
  readonly halls: readonly TimelineHall[];
  readonly items: readonly AdminShowtime[];
  readonly nextCursor: string | null;
  readonly total: number;
}

/**
 * Scheduled showtimes on cinema dates `from` to `to` (both included, at most 31 dates), for U8:
 * by movie, by theater, or both, optionally only those starting after `startsAfter`.
 */
export interface ScheduledShowtimeFilter {
  readonly from: CalendarDate;
  readonly to: CalendarDate;
  readonly movieIds?: readonly number[];
  readonly theaterIds?: readonly number[];
  readonly startsAfter?: Date;
}

/** The first scheduled showtime per movie on `cinemaDate` starting after `after` (U8 ticker). */
export interface NextShowtimeFilter {
  readonly cinemaDate: CalendarDate;
  readonly after: Date;
  readonly movieIds?: readonly number[];
  readonly theaterIds?: readonly number[];
}

// --- Booking seams (U10, U11, U14) ----------------------------------------------------------

/** Someone holding tickets to a showtime: a confirmed booking's contact (U10/U11). */
export interface ShowtimeTicketHolder {
  readonly bookingId: number;
  readonly bookingReference: string;
  readonly customerId: number | null;
  /** Validated by bookings; null when the booking has none. */
  readonly email: string | null;
  /** E.164; null when the booking has none. */
  readonly phone: string | null;
}

/** What `ShowtimeCancellationService.cancelBookings()` receives. */
export interface ShowtimeCancellationInput {
  /** The showtime as it was before the cancellation, locked `FOR UPDATE`. */
  readonly showtime: ShowtimeView;
  readonly reason: CancelReason;
  readonly actor: StaffPrincipal;
}

/** What cancelling a showtime's bookings did (U14). */
export interface ShowtimeCancellationOutcome {
  readonly refundedBookingCount: number;
  readonly releasedHoldCount: number;
  readonly notifiedCount: number;
}

// --- Messages -------------------------------------------------------------------------------

/** The parameters of the "showtime moved" email and SMS (PRD "Notifications"). */
export interface ShowtimeMovedParams {
  readonly bookingReference: string;
  readonly movieTitle: string;
  readonly theaterName: string;
  readonly hallName: string;
  /** `formatCairoDisplay`, such as `Fri 16 Oct 2026, 19:30`. */
  readonly previousStartsAt: string;
  readonly startsAt: string;
}

// --- Audit ----------------------------------------------------------------------------------

/** Extra details of one audit event of a showtime write. */
export interface ShowtimeAuditDetails {
  readonly changedFields?: readonly string[];
  readonly metadata?: Readonly<Record<string, AuditMetadataValue>>;
}

// --- Error details --------------------------------------------------------------------------

/** One showtime of `SHOWTIME_CONFLICT` and `SHOWTIMES_NOT_CREATED` details, times in Cairo ISO. */
export interface ConflictDetail {
  readonly showtimeId: number;
  readonly movieTitle: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly cleaningEndsAt: string;
}

/** One date of `SHOWTIMES_NOT_CREATED` `details.results`. */
export interface BatchItemDetail {
  readonly cinemaDate: CalendarDate;
  /** `available` for a date that would have fitted. */
  readonly result: CheckResult;
  readonly conflicts: readonly ConflictDetail[];
}

/** `OUTSIDE_OPENING_HOURS` `details.window`: the date's window in Cairo ISO. */
export interface OpeningWindowDetail {
  readonly opensAt: string;
  readonly closesAt: string;
}

/** One date of a batch create once it was attempted: its check and the showtimes in its way. */
export interface BatchDateOutcome {
  readonly check: DateCheck;
  readonly conflicts: readonly ShowtimeConflict[];
}

/** The columns a move rewrites. */
export interface ShowtimeMoveColumns {
  readonly starts_at: Date;
  readonly ends_at: Date;
  readonly cleaning_ends_at: Date;
  readonly cinema_date: CalendarDate;
}

/** The columns a price change rewrites. */
export interface ShowtimePriceColumns {
  readonly price_front: number;
  readonly price_middle: number;
  readonly price_back: number;
  readonly currency: Currency;
}
