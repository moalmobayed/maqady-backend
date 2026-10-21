/**
 * A showtime's status (design §6.2). Mirrored by `chk_showtimes_status`.
 *
 * - `scheduled`: on the timeline and, while its theater sells, on sale until it starts. Started
 *   and ended are not statuses: they follow from the clock (design §7.4).
 * - `cancelled`: called off by an admin with a reason; final. It leaves the cleaning-gap
 *   constraint, so its slot can be scheduled again.
 */
export const SHOWTIME_STATUSES = ['scheduled', 'cancelled'] as const;

/**
 * Why an admin cancelled a showtime (PRD "Showtimes" 6). Mirrored by
 * `chk_showtimes_cancel_reason`.
 */
export const CANCEL_REASONS = [
  'technical_issue',
  'print_not_delivered',
  'low_sales',
  'private_event',
] as const;

/**
 * What the checks say about one requested cinema date (PRD A5 "Available, Conflict, Outside
 * opening hours"), in the order they are made; the first failing check wins:
 *
 * - `time_does_not_exist`: the start time is skipped by the summer-time change that night;
 * - `in_past`: the start is not after now;
 * - `outside_opening_hours`: the showtime would not start and end inside the date's opening
 *   window, or the theater is closed or has no hours that date;
 * - `conflict`: it would be closer than 20 minutes to another showtime in the hall;
 * - `available`: every check passed.
 */
export const CHECK_RESULTS = [
  'available',
  'conflict',
  'outside_opening_hours',
  'time_does_not_exist',
  'in_past',
] as const;

/** A batch item: `created`, or the failing check that kept the date from being created. */
export const BATCH_RESULTS = [
  'created',
  'conflict',
  'outside_opening_hours',
  'time_does_not_exist',
  'in_past',
] as const;

/** Why a movie and hall can't be scheduled at all (`SHOWTIME_NOT_SCHEDULABLE` `details.reasons`). */
export const NOT_SCHEDULABLE_REASONS = [
  'movie_not_now_showing',
  'hall_not_active',
  'no_prices',
] as const;

/** Why a showtime can't be changed (`SHOWTIME_NOT_EDITABLE` `details.reason`). */
export const NOT_EDITABLE_REASONS = ['started', 'ended', 'cancelled'] as const;
