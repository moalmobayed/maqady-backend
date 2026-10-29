/** The stored booking statuses (design §6.2 `bookings.status`). */
export const BOOKING_STATUSES = ['held', 'confirmed', 'refunded'] as const;

/**
 * The six statuses the API shows (design §7.4, PRD "Statuses"): the stored three, plus Failed
 * and Abandoned (a hold that ended) and Completed (a confirmed booking whose showtime ended),
 * decided at read time from stored times by `booking-status.sql.ts`.
 */
export const BOOKING_DISPLAY_STATUSES = [
  'held',
  'failed',
  'abandoned',
  'confirmed',
  'completed',
  'refunded',
] as const;

/** Where a booking was made (design §6.2 `bookings.channel`). Counter sales come with U13. */
export const BOOKING_CHANNELS = ['online', 'counter'] as const;

/**
 * Who acts on a booking: a guest with a hold code, a signed-in customer (who owns it), or staff
 * (a counter booking with no customer account: the box office member's hold, then a walk-in or
 * typed-contact sale, U13).
 */
export const HOLD_OWNERS = ['guest', 'customer', 'staff'] as const;

/**
 * Why a showtime cannot be held right now (design §7.3 steps 2–3), in order of precedence: the
 * first that applies is the one reported.
 */
export const NOT_BOOKABLE_REASONS = [
  'cancelled',
  'started',
  'sales_paused',
  'movie_unavailable',
  'hall_unavailable',
] as const;

/** Why a hold was released, in the `booking.released` audit event. */
export const RELEASE_REASONS = ['released', 'replaced'] as const;

/**
 * A booking's payment status as the UI shows it (design §7.4; PRD "Statuses"): decided with the
 * booking status by `paymentStatusOf()` in `booking-status.sql.ts`.
 */
export const PAYMENT_STATUS_DISPLAYS = [
  'unpaid',
  'processing',
  'declined',
  'paid',
  'refunded',
] as const;

/** What a route settles before it runs (`@SettleFirst()`): the booking `{ref}`, or showtime `{id}`. */
export const SETTLE_FIRST_KINDS = ['booking', 'showtime'] as const;

/**
 * Where `@SettleFirst()` reads the booking reference or showtime id: the path (`{ref}`, `{id}`),
 * or the JSON body's `showtimeId` (`POST /admin/counter-holds`, U13).
 */
export const SETTLE_FIRST_SOURCES = ['params', 'body'] as const;

/** The booking statuses that have a ticket: a QR code, a PDF and a calendar file. */
export const TICKET_STATUSES = ['confirmed', 'completed'] as const;

/**
 * Why settlement refunded a succeeded payment at once (design §7.5): its seats were no longer
 * all the booking's, or its showtime was cancelled meanwhile.
 */
export const AUTOMATIC_REFUND_REASONS = ['claims_lost', 'showtime_cancelled'] as const;

// --- Box office (U13) -----------------------------------------------------------------------

/**
 * Who a counter sale is for (PRD A6 "New booking"): a walk-in (no details), an existing customer
 * account, or contact details typed at the counter.
 */
export const COUNTER_CUSTOMER_KINDS = ['walk_in', 'existing', 'contact'] as const;

/**
 * What a scan answers (design §7.9; PRD "Scan tickets"): `VALID` admits the booking now;
 * `ALREADY_USED` it was admitted before; `WRONG_SHOWTIME` another theater, a cancelled showtime or
 * outside the scan window; `NOT_VALID` unpaid, refunded or an old QR code; `NOT_FOUND` not a
 * Maqady ticket; `CONFIRM_REQUIRED` a typed reference, waiting for the second request.
 */
export const SCAN_RESULTS = [
  'VALID',
  'ALREADY_USED',
  'WRONG_SHOWTIME',
  'NOT_VALID',
  'NOT_FOUND',
  'CONFIRM_REQUIRED',
] as const;

/** Why a scan is `WRONG_SHOWTIME` (the first four) or `NOT_VALID` (the last three). */
export const SCAN_REASONS = [
  'other_theater',
  'cancelled',
  'not_open_yet',
  'ended',
  'not_paid',
  'refunded',
  'replaced',
] as const;

/** How a ticket was presented at the entrance: its QR code, or its reference typed by hand. */
export const SCAN_VIA = ['qr', 'reference'] as const;
