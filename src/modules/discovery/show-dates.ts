import { addDays, weekdayOfCinemaDate } from '../../common/time/time';
import type { CalendarDate } from '../../common/time/types';
import { WEEKEND_FIRST_WEEKDAY, WEEKEND_LAST_WEEKDAY } from './discovery.constants';
import { SHOW_DATES } from './enums';
import type { CinemaDateRange, ShowDate, ShowDateRanges } from './types';

/** Pure date rules of the showtime reads, judged on cinema dates (06:00 to 06:00, design §8). */

/** `count` consecutive cinema dates starting with `first`. */
export function cinemaDatesFrom(first: CalendarDate, count: number): CalendarDate[] {
  return Array.from({ length: count }, (_, index) => addDays(first, index));
}

/**
 * The cinema dates a "show date" filter covers, seen from `today` (PRD C2, "Time" 3): today;
 * tomorrow; or this weekend, Friday and Saturday — from today on a Friday, today only on a
 * Saturday, else the coming Friday and Saturday.
 */
export function showDateRange(showDate: ShowDate, today: CalendarDate): CinemaDateRange {
  if (showDate === 'today') return { from: today, to: today };
  if (showDate === 'tomorrow') {
    const tomorrow = addDays(today, 1);
    return { from: tomorrow, to: tomorrow };
  }
  const weekday = weekdayOfCinemaDate(today);
  if (weekday === WEEKEND_LAST_WEEKDAY) return { from: today, to: today };
  const friday = addDays(today, (WEEKEND_FIRST_WEEKDAY - weekday + 7) % 7);
  return { from: friday, to: addDays(friday, WEEKEND_LAST_WEEKDAY - WEEKEND_FIRST_WEEKDAY) };
}

/** The cinema dates of a range, `from` to `to`, both included (`YYYY-MM-DD` sorts as dates). */
export function cinemaDatesOf(range: CinemaDateRange): CalendarDate[] {
  const dates: CalendarDate[] = [];
  for (let date = range.from; date <= range.to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

/**
 * Every "show date" option in `SHOW_DATES` order with its range seen from `today`, and the one
 * range that covers them all (today to the latest last date), to read the showtimes once.
 */
export function showDateRanges(today: CalendarDate): ShowDateRanges {
  const options = SHOW_DATES.map((value) => ({ value, range: showDateRange(value, today) }));
  const to = options.reduce(
    (last, option) => (option.range.to > last ? option.range.to : last),
    today,
  );
  return { options, covering: { from: today, to } };
}
