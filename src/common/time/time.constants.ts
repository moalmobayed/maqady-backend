/** The one time zone (design §8). Every wall-clock conversion goes through `time.ts`. */
export const CAIRO_TIME_ZONE = 'Africa/Cairo';

/** A cinema day runs from 06:00 to 06:00 local time (design §8). */
export const CINEMA_DAY_START_HOUR = 6;

/** Stored opening minutes count from midnight at the start of the cinema date (design §6.2). */
export const MAX_CINEMA_MINUTE = 1800;

/** How the API writes an instant: Cairo wall time with its offset, no milliseconds. */
export const CAIRO_ISO_FORMAT = "yyyy-MM-dd'T'HH:mm:ssZZ";

/** `YYYY-MM-DD`, a calendar or cinema date. */
export const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** An instant as the API and `Date.toISOString()` write it: date, time, offset or `Z`. */
export const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

/** `HH:mm`, a 24-hour wall-clock time as an admin types it. */
export const WALL_CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Upper bound when searching for the end of a summer-time gap; Cairo's is 60 minutes. */
export const MAX_GAP_MINUTES = 180;
