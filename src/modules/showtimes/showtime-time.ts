import { AppError } from '../../common/errors/app-error';
import { money } from '../../common/money/money';
import type { Money } from '../../common/money/types';
import { addDays, addToInstant, wallClockToInstant } from '../../common/time/time';
import type { CalendarDate } from '../../common/time/types';
import { ZONES } from '../halls/enums';
import type { ZoneSeatCounts } from '../halls/types';
import type { OpeningWindow, ZonePrices } from '../theaters/types';
import {
  CINEMA_DAY_END_MINUTE,
  CINEMA_DAY_FIRST_MINUTE,
  CLEANING_GAP_MINUTES,
  MAX_SUGGESTIONS,
  START_TIME_PATTERN,
  SUGGESTION_STEP_MINUTES,
} from './showtimes.constants';
import type { BusySlot, ShowtimeSpan, SuggestedStart, SuggestionInput } from './types';

/**
 * Showtime time rules (design §8), as pure functions: no database, no clock. Wall-clock times
 * become instants only through `common/time`, so the summer-time rules live there.
 *
 * - An admin picks a cinema date and a start time `HH:mm`. A cinema day runs from 06:00 to
 *   06:00, so `06:00`–`23:59` is on the cinema date itself and `00:00`–`05:59` on the next
 *   calendar date: 16 Oct + `00:30` starts at 2026-10-17 00:30 and belongs to 16 Oct.
 * - A start that doesn't exist that night (the spring-forward hour) is `TIME_DOES_NOT_EXIST`; one
 *   that occurs twice (the fall-back hour) is its first occurrence.
 * - A showtime ends `runtime` minutes of real time after it starts and its hall is clean 20
 *   minutes later, so a summer-time change during a screening never shortens the film.
 */

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/** `HH:mm` as a minute of its cinema day: `06:00` is 360, `00:30` is 1470 (the next calendar day). */
export function cinemaMinuteOf(startTime: string): number {
  if (!START_TIME_PATTERN.test(startTime))
    throw new AppError('INTERNAL', 'A start time must be written HH:mm.');
  const [hours, minutes] = startTime.split(':').map(Number) as [number, number];
  const minute = hours * MINUTES_PER_HOUR + minutes;
  return minute < CINEMA_DAY_FIRST_MINUTE ? minute + MINUTES_PER_DAY : minute;
}

/** A minute of a cinema day as the admin types it: 1470 is `00:30`. */
export function startTimeOf(cinemaMinute: number): string {
  const ofDay = cinemaMinute % MINUTES_PER_DAY;
  const hours = String(Math.floor(ofDay / MINUTES_PER_HOUR)).padStart(2, '0');
  const minutes = String(ofDay % MINUTES_PER_HOUR).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * The instant a showtime on `cinemaDate` at `startTime` starts. `TIME_DOES_NOT_EXIST` (with the
 * calendar `date`, the `time` and the `cinemaDate`) when the clocks skip it that night.
 */
export function startInstantFor(cinemaDate: CalendarDate, startTime: string): Date {
  const date = cinemaMinuteOf(startTime) >= MINUTES_PER_DAY ? addDays(cinemaDate, 1) : cinemaDate;
  try {
    return wallClockToInstant(date, startTime);
  } catch (error) {
    if (error instanceof AppError && error.code === 'TIME_DOES_NOT_EXIST') {
      throw new AppError('TIME_DOES_NOT_EXIST', undefined, { date, time: startTime, cinemaDate });
    }
    throw error;
  }
}

/** As `startInstantFor`, but null for a start that doesn't exist that night. */
export function startInstantOrNull(cinemaDate: CalendarDate, startTime: string): Date | null {
  try {
    return startInstantFor(cinemaDate, startTime);
  } catch (error) {
    if (error instanceof AppError && error.code === 'TIME_DOES_NOT_EXIST') return null;
    throw error;
  }
}

/** When a showtime starting at `startsAt` ends and when its hall is clean again. */
export function showtimeSpan(startsAt: Date, runtimeMinutes: number): ShowtimeSpan {
  if (!Number.isInteger(runtimeMinutes) || runtimeMinutes < 1) {
    throw new AppError('INTERNAL', 'A runtime must be a positive whole number of minutes.');
  }
  const endsAt = addToInstant(startsAt, { minutes: runtimeMinutes });
  return {
    startsAt,
    endsAt,
    cleaningEndsAt: addToInstant(endsAt, { minutes: CLEANING_GAP_MINUTES }),
  };
}

/**
 * True when the showtime starts and ends inside the opening window (design §8); ending exactly
 * at closing fits. The cleaning after it may run past closing. A closed date fits nothing.
 */
export function fitsWindow(span: ShowtimeSpan, window: OpeningWindow | null): boolean {
  if (!window) return false;
  return (
    window.opensAt.getTime() <= span.startsAt.getTime() &&
    span.endsAt.getTime() <= window.closesAt.getTime()
  );
}

/**
 * The busy slots a showtime would overlap, cleaning included: the same rule as the exclusion
 * constraint, `[startsAt, cleaningEndsAt)` ranges that intersect. A showtime may start exactly
 * when another's cleaning ends.
 */
export function overlaps(span: ShowtimeSpan, busy: readonly BusySlot[]): BusySlot[] {
  return busy.filter(
    (slot) =>
      span.startsAt.getTime() < slot.cleaningEndsAt.getTime() &&
      slot.startsAt.getTime() < span.cleaningEndsAt.getTime(),
  );
}

/**
 * Up to three free starts for a date that doesn't fit (design §8): on the wall-clock 5-minute
 * grid from `06:00` to `05:55`, skipping times that don't exist that night, after `now`, inside
 * the window and clear of every busy slot. The nearest to the requested time come first, the
 * earlier one on a tie. None for a closed date.
 */
export function suggestStarts(input: SuggestionInput): SuggestedStart[] {
  if (!input.window) return [];
  const requested = cinemaMinuteOf(input.requestedTime);
  const candidates: { minute: number; suggestion: SuggestedStart }[] = [];
  for (
    let minute = CINEMA_DAY_FIRST_MINUTE;
    minute < CINEMA_DAY_END_MINUTE;
    minute += SUGGESTION_STEP_MINUTES
  ) {
    const startTime = startTimeOf(minute);
    const startsAt = startInstantOrNull(input.cinemaDate, startTime);
    if (!startsAt || startsAt.getTime() <= input.now.getTime()) continue;
    const span = showtimeSpan(startsAt, input.runtimeMinutes);
    if (!fitsWindow(span, input.window) || overlaps(span, input.busy).length > 0) continue;
    candidates.push({ minute, suggestion: { startTime, startsAt } });
  }
  return candidates
    .sort(
      (a, b) =>
        Math.abs(a.minute - requested) - Math.abs(b.minute - requested) || a.minute - b.minute,
    )
    .slice(0, MAX_SUGGESTIONS)
    .map(({ suggestion }) => suggestion);
}

/**
 * A showtime's "from" price (design §7.10): the lowest zone price among the zones its hall's
 * layout has seats in. A layout always has a seat; if none were counted, every zone counts.
 */
export function fromPrice(prices: ZonePrices, zoneSeatCounts: ZoneSeatCounts): Money {
  const zones = ZONES.filter((zone) => zoneSeatCounts[zone] > 0);
  const candidates = (zones.length > 0 ? zones : ZONES).map((zone) => prices[zone]);
  const cheapest = candidates.reduce((low, price) => (price.amount < low.amount ? price : low));
  return money(cheapest.amount, cheapest.currency);
}
