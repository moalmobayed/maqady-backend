import { AppError } from '../../common/errors/app-error';
import type { FieldError } from '../../common/errors/types';
import { MAX_CINEMA_MINUTE, WALL_CLOCK_TIME_PATTERN } from '../../common/time/time.constants';
import {
  addDays,
  cinemaDateOf,
  cinemaMinuteToInstant,
  weekdayOfCinemaDate,
} from '../../common/time/time';
import type { CalendarDate } from '../../common/time/types';
import {
  MAX_OPENS_MINUTE,
  MIN_OPENS_MINUTE,
  NEXT_DAY_CLOSING_LIMIT_MINUTE,
  OPEN_STATE_LOOKAHEAD_DAYS,
} from './theaters.constants';
import type {
  CinemaDateHours,
  DayHours,
  HoursSpec,
  OpeningWindow,
  OpenState,
  SpecialDate,
  WallClockHoursInput,
  WallClockTime,
} from './types';

/**
 * Opening hours (design §8), as pure functions: no database, no clock. Wall-clock times become
 * instants only through `common/time`, so summer-time rules live there:
 *
 * - an admin types `opens` and `closes` as `HH:mm`; a `closes` at or before 06:00 is on the next
 *   calendar day, so `12:00`–`01:00` is stored as minutes 720–1500 of the cinema date;
 * - a stored minute that falls into the skipped summer-time hour moves forward to the first valid
 *   time, and one that occurs twice is its first occurrence (`cinemaMinuteToInstant`);
 * - a cinema date's window lies between 06:00 on its date and 06:00 the next day, so windows of
 *   different cinema dates never overlap, and an instant can only be inside the window of its own
 *   cinema date (`cinemaDateOf`): 01:30 on Thursday is judged by Wednesday's hours (PRD C4).
 */

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

export const OPENS_MESSAGE = 'opens must be a time from 06:00 to 23:59, written HH:mm';
export const CLOSES_MESSAGE =
  'closes must be after opens, written HH:mm; a closing at or before 06:00 is the next day';
export const CLOSED_WITH_TIMES_MESSAGE = 'leave out opens and closes on a closed day';
export const OPEN_WITHOUT_TIMES_MESSAGE = 'opens and closes are required on an open day';

/** `HH:mm` as minutes since midnight (0–1439); null when malformed. */
export function minuteOfDay(time: string): number | null {
  const match = WALL_CLOCK_TIME_PATTERN.exec(time);
  if (!match) return null;
  return Number(match[1]) * MINUTES_PER_HOUR + Number(match[2]);
}

/** An `opens` time as a stored minute: 06:00 to 23:59, else null. */
export function opensMinuteOf(time: string): number | null {
  const minute = minuteOfDay(time);
  if (minute === null || minute < MIN_OPENS_MINUTE || minute > MAX_OPENS_MINUTE) return null;
  return minute;
}

/** A `closes` time as a stored minute: at or before 06:00 is the next day (`00:00` → 1440). */
export function closesMinuteOf(time: string): number | null {
  const minute = minuteOfDay(time);
  if (minute === null) return null;
  return minute <= NEXT_DAY_CLOSING_LIMIT_MINUTE ? minute + MINUTES_PER_DAY : minute;
}

/** True when `opens` and `closes` make a valid opening: `opens` valid, then `closes` after it. */
export function isValidClosing(opens: string, closes: string): boolean {
  const opensMinute = opensMinuteOf(opens);
  const closesMinute = closesMinuteOf(closes);
  return opensMinute !== null && closesMinute !== null && opensMinute < closesMinute;
}

/**
 * What is wrong with the hours of one day, as `VALIDATION_FAILED` field errors under `prefix`
 * (`days.2.` for the third weekday, `''` for a special date). Empty when they are valid.
 */
export function hoursProblems(input: WallClockHoursInput, prefix = ''): FieldError[] {
  const problems: FieldError[] = [];
  const has = (value: string | undefined): value is string => value !== undefined;
  if (input.closed) {
    for (const field of ['opens', 'closes'] as const) {
      if (has(input[field])) {
        problems.push({ field: `${prefix}${field}`, messages: [CLOSED_WITH_TIMES_MESSAGE] });
      }
    }
    return problems;
  }
  if (!has(input.opens) || !has(input.closes)) {
    for (const field of ['opens', 'closes'] as const) {
      if (!has(input[field])) {
        problems.push({ field: `${prefix}${field}`, messages: [OPEN_WITHOUT_TIMES_MESSAGE] });
      }
    }
    return problems;
  }
  if (opensMinuteOf(input.opens) === null) {
    problems.push({ field: `${prefix}opens`, messages: [OPENS_MESSAGE] });
  } else if (!isValidClosing(input.opens, input.closes)) {
    problems.push({ field: `${prefix}closes`, messages: [CLOSES_MESSAGE] });
  }
  return problems;
}

/** Valid hours as stored minutes. Call after `hoursProblems()` found nothing. */
export function toHoursSpec(input: WallClockHoursInput): HoursSpec {
  if (hoursProblems(input).length > 0) {
    throw new AppError('INTERNAL', 'Opening hours must be validated before they are stored.');
  }
  if (input.closed) return { closed: true, opensMinute: null, closesMinute: null };
  return {
    closed: false,
    opensMinute: opensMinuteOf(input.opens!),
    closesMinute: closesMinuteOf(input.closes!),
  };
}

/**
 * Stored hours with some of `closed`, `opens` and `closes` changed (a `PATCH`): an omitted time
 * keeps its stored minute, and the result is checked as a whole. Field errors name `opens` and
 * `closes` as the request does.
 */
export function mergeHours(
  stored: HoursSpec,
  changes: Partial<WallClockHoursInput>,
): { readonly hours: HoursSpec; readonly problems: FieldError[] } {
  const closed = changes.closed ?? stored.closed;
  if (closed) {
    const sent = (['opens', 'closes'] as const).filter((field) => changes[field] !== undefined);
    return {
      hours: { closed: true, opensMinute: null, closesMinute: null },
      problems: sent.map((field) => ({ field, messages: [CLOSED_WITH_TIMES_MESSAGE] })),
    };
  }
  const opensMinute =
    changes.opens !== undefined ? opensMinuteOf(changes.opens) : stored.opensMinute;
  const closesMinute =
    changes.closes !== undefined ? closesMinuteOf(changes.closes) : stored.closesMinute;
  const hours: HoursSpec = { closed: false, opensMinute, closesMinute };
  const problems: FieldError[] = [];
  if (opensMinute === null) {
    problems.push({
      field: 'opens',
      messages: [changes.opens !== undefined ? OPENS_MESSAGE : OPEN_WITHOUT_TIMES_MESSAGE],
    });
  }
  if (closesMinute === null) {
    problems.push({
      field: 'closes',
      messages: [changes.closes !== undefined ? CLOSES_MESSAGE : OPEN_WITHOUT_TIMES_MESSAGE],
    });
  } else if (opensMinute !== null && opensMinute >= closesMinute) {
    problems.push({ field: 'closes', messages: [CLOSES_MESSAGE] });
  }
  return { hours, problems };
}

/** A stored minute as the admin typed it: 1500 is `01:00` on the next day. */
export function openingMinuteToWallClock(minute: number): WallClockTime {
  if (!Number.isInteger(minute) || minute < 0 || minute > MAX_CINEMA_MINUTE) {
    throw new AppError('INTERNAL', `An opening minute must be an integer from 0 to 1800.`);
  }
  const ofDay = minute % MINUTES_PER_DAY;
  const hours = String(Math.floor(ofDay / MINUTES_PER_HOUR)).padStart(2, '0');
  const minutes = String(ofDay % MINUTES_PER_HOUR).padStart(2, '0');
  return { time: `${hours}:${minutes}`, nextDay: minute >= MINUTES_PER_DAY };
}

/** The opening window of a cinema date with these hours; null when closed or unknown. */
export function windowOf(cinemaDate: CalendarDate, hours: HoursSpec | null): OpeningWindow | null {
  if (!hours || hours.closed || hours.opensMinute === null || hours.closesMinute === null) {
    return null;
  }
  return {
    opensAt: cinemaMinuteToInstant(cinemaDate, hours.opensMinute),
    closesAt: cinemaMinuteToInstant(cinemaDate, hours.closesMinute),
  };
}

/**
 * The hours of one cinema date (design §8): the special date's if there is one for that date,
 * else the weekly hours of its weekday, else none.
 */
export function resolveCinemaDateHours(
  cinemaDate: CalendarDate,
  weekly: readonly DayHours[],
  specials: readonly SpecialDate[],
): CinemaDateHours {
  const weekday = weekdayOfCinemaDate(cinemaDate);
  const special = specials.find((candidate) => candidate.cinemaDate === cinemaDate);
  if (special) {
    const hours = hoursOf(special);
    return {
      cinemaDate,
      weekday,
      source: 'special',
      specialDateLabel: special.label,
      hours,
      window: windowOf(cinemaDate, hours),
    };
  }
  const day = weekly.find((candidate) => candidate.weekday === weekday);
  if (day) {
    const hours = hoursOf(day);
    return {
      cinemaDate,
      weekday,
      source: 'weekly',
      specialDateLabel: null,
      hours,
      window: windowOf(cinemaDate, hours),
    };
  }
  return { cinemaDate, weekday, source: 'none', specialDateLabel: null, hours: null, window: null };
}

/** Every cinema date from `from` to `to`, both included. */
export function cinemaDatesBetween(from: CalendarDate, to: CalendarDate): CalendarDate[] {
  const dates: CalendarDate[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

/** The cinema dates an open state at `at` looks at: its own and the next 7. */
export function openStateDates(at: Date): { from: CalendarDate; to: CalendarDate } {
  const from = cinemaDateOf(at);
  return { from, to: addDays(from, OPEN_STATE_LOOKAHEAD_DAYS) };
}

/**
 * Whether the theater is open at `at`, from the hours of the cinema dates `openStateDates(at)`
 * names (others are ignored; a missing date counts as no hours):
 *
 * - open when `at` is inside the window of its own cinema date, until that window closes;
 * - otherwise closed, and `nextOpensAt` is the first window opening after `at` among its cinema
 *   date and the next 7, or null.
 */
export function openStateAt(at: Date, days: readonly CinemaDateHours[]): OpenState {
  const { from, to } = openStateDates(at);
  const moment = at.getTime();
  const windows = days
    .filter((day) => day.cinemaDate >= from && day.cinemaDate <= to && day.window !== null)
    .map((day) => day.window!)
    .sort((first, second) => first.opensAt.getTime() - second.opensAt.getTime());

  const current = windows.find(
    (window) => window.opensAt.getTime() <= moment && moment < window.closesAt.getTime(),
  );
  if (current) return { isOpen: true, closesAt: current.closesAt, nextOpensAt: null };
  const next = windows.find((window) => window.opensAt.getTime() > moment);
  return { isOpen: false, closesAt: null, nextOpensAt: next?.opensAt ?? null };
}

function hoursOf(hours: HoursSpec): HoursSpec {
  return { closed: hours.closed, opensMinute: hours.opensMinute, closesMinute: hours.closesMinute };
}
