/** Every showtime is followed by this much cleaning time in its hall (PRD "Showtimes" 2). */
export const CLEANING_GAP_MINUTES = 20;

/** Suggested start times lie on this wall-clock grid (design §8). */
export const SUGGESTION_STEP_MINUTES = 5;

/** At most this many suggestions per date that doesn't fit. */
export const MAX_SUGGESTIONS = 3;

/** A dry run or a batch takes 1 to this many dates. */
export const MAX_BATCH_DATES = 31;

/** The dates of one request lie within this many days, first and last included. */
export const MAX_DATE_SPAN_DAYS = 31;

/** U8's reads by date range answer at most this many cinema dates. */
export const MAX_READ_RANGE_DAYS = 31;

/** The exclusion constraint of migration `0080_01`: a violation is a schedule conflict. */
export const SHOWTIME_GAP_CONSTRAINT = 'ex_showtimes_hall_cleaning_gap';

/**
 * A cinema day's wall clock runs 06:00 to 06:00: a start from `00:00` to `05:59` is on the next
 * calendar day (design §8). Minutes count from midnight at the start of the cinema date.
 */
export const CINEMA_DAY_FIRST_MINUTE = 6 * 60;
export const CINEMA_DAY_END_MINUTE = 30 * 60;

/** `HH:mm`, a start time as an admin types it. */
export const START_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The message of a start time that is not `HH:mm`. */
export const START_TIME_MESSAGE = 'startTime must be a 24-hour time written HH:mm, such as 19:30';

/** The keys this unit registers with the hall, theater and movie lifecycle registries. */
export const SHOWTIME_LIFECYCLE_KEYS = {
  hasShowtimes: 'has_showtimes',
  hasFutureShowtimes: 'has_future_showtimes',
  showtimeCapacity: 'showtime_capacity',
  hallInUse: 'hall_in_use',
} as const;
