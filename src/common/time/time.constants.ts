/** The one time zone (design §8). Every wall-clock conversion goes through `time.ts`. */
export const CAIRO_TIME_ZONE = 'Africa/Cairo';

/** A cinema day runs from 06:00 to 06:00 local time (design §8). */
export const CINEMA_DAY_START_HOUR = 6;

/** Stored opening minutes count from midnight at the start of the cinema date (design §6.2). */
export const MAX_CINEMA_MINUTE = 1800;

/** How the API writes an instant: Cairo wall time with its offset, no milliseconds. */
export const CAIRO_ISO_FORMAT = "yyyy-MM-dd'T'HH:mm:ssZZ";

/** How messages write an instant for people: `Fri 16 Oct 2026, 19:30`, Cairo wall clock. */
export const CAIRO_DISPLAY_FORMAT = 'ccc d LLL yyyy, HH:mm';

/** A Cairo wall-clock time of day, `19:30`. */
export const CAIRO_WALL_CLOCK_FORMAT = 'HH:mm';

/** `YYYY-MM-DD`, a calendar or cinema date. */
export const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** An instant as the API and `Date.toISOString()` write it: date, time, offset or `Z`. */
export const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

/**
 * The largest UTC offset an instant may carry, in minutes: real time zones stay within 14 hours
 * either way. Larger ones parse in Luxon but not in `Date`, or in `Date` but not in Postgres.
 */
export const MAX_UTC_OFFSET_MINUTES = 14 * 60;

/** `HH:mm`, a 24-hour wall-clock time as an admin types it. */
export const WALL_CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Upper bound when searching for the end of a summer-time gap; Cairo's is 60 minutes. */
export const MAX_GAP_MINUTES = 180;
