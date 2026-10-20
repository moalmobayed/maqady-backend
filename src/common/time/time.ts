import { DateTime } from 'luxon';
import { AppError } from '../errors/app-error';
import {
  CAIRO_ISO_FORMAT,
  CAIRO_TIME_ZONE,
  CALENDAR_DATE_PATTERN,
  CINEMA_DAY_START_HOUR,
  ISO_INSTANT_PATTERN,
  MAX_CINEMA_MINUTE,
  MAX_GAP_MINUTES,
  WALL_CLOCK_TIME_PATTERN,
} from './time.constants';
import type { CalendarDate, CinemaDayBounds, InstantDuration, IsoWeekday } from './types';

/**
 * The shared time helpers (design §8). This is the only place that converts between Cairo wall
 * clock and instants, so summer-time rules live in one file. Everywhere else, instants are
 * `Date`s from the `Clock` or the database, and dates are `YYYY-MM-DD` strings. Inline offset or
 * millisecond arithmetic is forbidden (CLAUDE.md "Anti-patterns").
 */

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/** True for a real calendar date written `YYYY-MM-DD` (so `2026-02-30` is false). */
export function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE_PATTERN.test(value)) return false;
  const parsed = DateTime.fromISO(value, { zone: 'utc' });
  return parsed.isValid && parsed.toISODate() === value;
}

/**
 * True for a real instant written in ISO 8601 with its offset, such as
 * `2026-10-16T19:30:00+03:00` or `2026-10-16T16:30:00.000Z`; false for a bare date, a time
 * without an offset, or an impossible date.
 */
export function isIsoInstant(value: string): boolean {
  return ISO_INSTANT_PATTERN.test(value) && DateTime.fromISO(value, { setZone: true }).isValid;
}

/** Calendar arithmetic on a date, independent of any time zone. */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  return calendarDay(date).plus({ days }).toISODate() as CalendarDate;
}

/**
 * The cinema date an instant belongs to (design §8). The instant is first turned into Cairo wall
 * time; before 06:00 it belongs to the previous calendar date, otherwise to the same one. Never
 * computed by subtracting six hours, which is wrong on summer-time days.
 *
 * @example cinemaDateOf(2026-10-17 00:30 Cairo) === '2026-10-16'
 */
export function cinemaDateOf(instant: Date): CalendarDate {
  const local = DateTime.fromJSDate(instant, { zone: CAIRO_TIME_ZONE });
  const date = local.toISODate() as CalendarDate;
  return local.hour < CINEMA_DAY_START_HOUR ? addDays(date, -1) : date;
}

/** The ISO weekday (1 = Monday … 7 = Sunday) of a cinema date, for weekly opening hours. */
export function weekdayOfCinemaDate(date: CalendarDate): IsoWeekday {
  return calendarDay(date).weekday as IsoWeekday;
}

/** 06:00 on the cinema date to 06:00 the next day, as instants. */
export function cinemaDayBounds(date: CalendarDate): CinemaDayBounds {
  return {
    startsAt: cinemaMinuteToInstant(date, CINEMA_DAY_START_HOUR * MINUTES_PER_HOUR),
    endsAt: cinemaMinuteToInstant(date, MAX_CINEMA_MINUTE),
  };
}

/**
 * An admin-entered Cairo wall-clock time (`HH:mm`) on a calendar date, as an instant (design §8):
 *
 * - a time that doesn't exist that night (the spring-forward hour) is refused with
 *   `TIME_DOES_NOT_EXIST`;
 * - a time that occurs twice (the fall-back hour) resolves to its first occurrence.
 */
export function wallClockToInstant(date: CalendarDate, time: string): Date {
  const match = WALL_CLOCK_TIME_PATTERN.exec(time);
  if (!match) throw new AppError('INTERNAL', 'A wall-clock time must be written HH:mm.');
  const minuteOfDay = Number(match[1]) * MINUTES_PER_HOUR + Number(match[2]);
  const instant = resolveWallClock(date, minuteOfDay);
  if (instant === undefined) {
    throw new AppError('TIME_DOES_NOT_EXIST', undefined, { date, time });
  }
  return instant;
}

/**
 * A stored opening minute as an instant. Minutes count from midnight at the start of the cinema
 * date, so 1500 is 01:00 the next calendar day (design §6.2). A minute that falls into a skipped
 * hour moves forward to the first valid minute after the gap, never refused, because it was
 * valid when entered; one that occurs twice resolves to its first occurrence.
 */
export function cinemaMinuteToInstant(cinemaDate: CalendarDate, minute: number): Date {
  if (!Number.isInteger(minute) || minute < 0 || minute > MAX_CINEMA_MINUTE) {
    throw new AppError(
      'INTERNAL',
      `A cinema minute must be an integer from 0 to ${MAX_CINEMA_MINUTE}.`,
    );
  }
  const date = addDays(cinemaDate, Math.floor(minute / MINUTES_PER_DAY));
  const minuteOfDay = minute % MINUTES_PER_DAY;
  const start = calendarDay(date).plus({ minutes: minuteOfDay });
  for (let shift = 0; shift <= MAX_GAP_MINUTES; shift += 1) {
    const wall = start.plus({ minutes: shift });
    const instant = resolveWallClock(
      wall.toISODate() as CalendarDate,
      wall.hour * MINUTES_PER_HOUR + wall.minute,
    );
    if (instant !== undefined) return instant;
  }
  throw new AppError('INTERNAL', 'No valid wall-clock time follows the requested one.');
}

/** An instant as the API writes it: Cairo time with its offset, `2026-10-16T19:30:00+03:00`. */
export function formatCairoIso(instant: Date): string {
  return DateTime.fromJSDate(instant, { zone: CAIRO_TIME_ZONE }).toFormat(CAIRO_ISO_FORMAT);
}

/** The instant a fixed amount of real time after another, for expiries such as "24 hours". */
export function addToInstant(instant: Date, duration: InstantDuration): Date {
  return DateTime.fromJSDate(instant, { zone: 'utc' }).plus(duration).toJSDate();
}

/** The instant a fixed amount of real time before another. */
export function subtractFromInstant(instant: Date, duration: InstantDuration): Date {
  return DateTime.fromJSDate(instant, { zone: 'utc' }).minus(duration).toJSDate();
}

/**
 * 00:00 UTC of the day after the instant's UTC date: when a provider's daily quota resets
 * (Resend counts days in UTC). An instant exactly at midnight gives the next midnight.
 */
export function startOfNextUtcDay(instant: Date): Date {
  return DateTime.fromJSDate(instant, { zone: 'utc' }).startOf('day').plus({ days: 1 }).toJSDate();
}

/** Midnight of a calendar date in UTC: a zone-free day for calendar arithmetic. */
function calendarDay(date: CalendarDate): DateTime {
  if (!isCalendarDate(date)) {
    throw new AppError('INTERNAL', 'A calendar date must be written YYYY-MM-DD.');
  }
  return DateTime.fromISO(date, { zone: 'utc' });
}

/**
 * A Cairo wall-clock minute on a date as an instant: the first occurrence when it occurs twice,
 * undefined when it doesn't exist (Luxon would silently move it forward by the gap).
 */
function resolveWallClock(date: CalendarDate, minuteOfDay: number): Date | undefined {
  const { year, month, day } = calendarDay(date);
  const hour = Math.floor(minuteOfDay / MINUTES_PER_HOUR);
  const minute = minuteOfDay % MINUTES_PER_HOUR;
  const local = DateTime.fromObject({ year, month, day, hour, minute }, { zone: CAIRO_TIME_ZONE });
  const exists =
    local.isValid &&
    local.year === year &&
    local.month === month &&
    local.day === day &&
    local.hour === hour &&
    local.minute === minute;
  if (!exists) return undefined;
  const first = DateTime.min(...local.getPossibleOffsets()) ?? local;
  return first.toJSDate();
}
