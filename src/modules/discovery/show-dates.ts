import { addDays, weekdayOfCinemaDate } from '../../common/time/time';
import type { CalendarDate } from '../../common/time/types';
import { WEEKEND_FIRST_WEEKDAY, WEEKEND_LAST_WEEKDAY } from './discovery.constants';
import type { CinemaDateRange, ShowDate } from './types';

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
