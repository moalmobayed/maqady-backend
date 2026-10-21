import type {
  BookingDisplayStatus,
  BookingStatusInput,
  HoldTiming,
  PaymentStatusDisplay,
  PaymentStatusInput,
  SqlPredicate,
  StatusAliases,
} from './types';

/**
 * The one owner of the clock-derived booking statuses (design §7.4). Only `held`, `confirmed`
 * and `refunded` are stored; Failed, Abandoned and Completed follow from stored times when read:
 *
 * | Shown     | Stored      | At `now`                                             |
 * |-----------|-------------|------------------------------------------------------|
 * | held      | `held`      | `hold_expires_at > now`                              |
 * | failed    | `held`      | `hold_expires_at <= now` and `has_declined_payment`  |
 * | abandoned | `held`      | `hold_expires_at <= now` and not declined            |
 * | confirmed | `confirmed` | the showtime's `ends_at > now`                       |
 * | completed | `confirmed` | the showtime's `ends_at <= now`                      |
 * | refunded  | `refunded`  | always                                               |
 *
 * `bookingStatusOf()` decides one booking in code; `bookingStatusPredicate()` gives the same
 * condition as SQL with `now` bound, for the lists, filters and counts of later units (U12, U14,
 * U17), which pass it to `whereRaw` in their repositories.
 */
export function bookingStatusOf(input: BookingStatusInput, now: Date): BookingDisplayStatus {
  const at = now.getTime();
  switch (input.status) {
    case 'held':
      if (input.holdExpiresAt.getTime() > at) return 'held';
      return input.hasDeclinedPayment ? 'failed' : 'abandoned';
    case 'confirmed':
      return input.showtimeEndsAt.getTime() > at ? 'confirmed' : 'completed';
    case 'refunded':
      return 'refunded';
  }
}

/**
 * The booking-level payment status the UI shows (design §7.4; PRD "Statuses"), derived from
 * stored facts like the booking status:
 *
 * | Payment status | When                                                                  |
 * |----------------|-----------------------------------------------------------------------|
 * | refunded       | the booking is `refunded`                                             |
 * | paid           | the booking is `confirmed` (Confirmed or Completed)                   |
 * | processing     | `held`, and its latest sale charge is still processing                |
 * | declined       | `held`, and a payment was declined (a Failed booking once it ended)   |
 * | unpaid         | `held` otherwise (an Abandoned booking once it ended)                 |
 */
export function paymentStatusOf(input: PaymentStatusInput): PaymentStatusDisplay {
  switch (input.status) {
    case 'refunded':
      return 'refunded';
    case 'confirmed':
      return 'paid';
    case 'held':
      if (input.latestSaleStatus === 'processing') return 'processing';
      return input.hasDeclinedPayment ? 'declined' : 'unpaid';
  }
}

/** True while a stored hold is live at `now` (the `held` row of the table). */
export function isLiveHold(input: HoldTiming, now: Date): boolean {
  return input.status === 'held' && input.holdExpiresAt.getTime() > now.getTime();
}

/**
 * The SQL condition of one shown status, on a booking aliased `aliases.booking` and (for
 * confirmed and completed) its showtime aliased `aliases.showtime`, with `now` bound.
 * Aliases are code constants, never input.
 */
export function bookingStatusPredicate(
  status: BookingDisplayStatus,
  aliases: StatusAliases,
  now: Date,
): SqlPredicate {
  const b = aliases.booking;
  const s = aliases.showtime;
  switch (status) {
    case 'held':
      return { sql: `(${b}.status = 'held' AND ${b}.hold_expires_at > ?)`, bindings: [now] };
    case 'failed':
      return {
        sql: `(${b}.status = 'held' AND ${b}.hold_expires_at <= ? AND ${b}.has_declined_payment)`,
        bindings: [now],
      };
    case 'abandoned':
      return {
        sql: `(${b}.status = 'held' AND ${b}.hold_expires_at <= ? AND NOT ${b}.has_declined_payment)`,
        bindings: [now],
      };
    case 'confirmed':
      return { sql: `(${b}.status = 'confirmed' AND ${s}.ends_at > ?)`, bindings: [now] };
    case 'completed':
      return { sql: `(${b}.status = 'confirmed' AND ${s}.ends_at <= ?)`, bindings: [now] };
    case 'refunded':
      return { sql: `(${b}.status = 'refunded')`, bindings: [] };
  }
}
