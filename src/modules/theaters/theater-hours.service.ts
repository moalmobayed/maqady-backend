import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { addDays, isCalendarDate } from '../../common/time/time';
import type { CalendarDate } from '../../common/time/types';
import {
  cinemaDatesBetween,
  openStateAt,
  openStateDates,
  resolveCinemaDateHours,
} from './opening-hours';
import { TheaterHoursRepository } from './theater-hours.repository';
import { groupByTheater, toDayHours, toSpecialDate } from './theater-rows';
import { MAX_HOURS_RANGE_DAYS } from './theaters.constants';
import type { CinemaDateHours, DayHours, OpeningWindow, OpenState, SpecialDate } from './types';

/**
 * Opening hours as other units read them (design §8; exported by `TheatersModule`). The hours of
 * a cinema date are its special date's, else its weekday's; instants come from the Cairo wall
 * clock through `common/time`, so summer-time changes are handled there. Every method reads the
 * hours of all the theaters asked for in two queries. None looks at the theater's status.
 *
 * - U7 schedules inside `windowFor()` (a showtime starts and ends within it).
 * - U8 shows `openStates()` on cards and `hoursFor()` for the week and the special dates.
 */
@Injectable()
export class TheaterHoursService {
  constructor(private readonly hours: TheaterHoursRepository) {}

  /** The opening window of one cinema date; null when closed or when no hours are set (U7). */
  async windowFor(theaterId: number, cinemaDate: CalendarDate): Promise<OpeningWindow | null> {
    const days = (await this.hoursFor([theaterId], cinemaDate, cinemaDate)).get(theaterId);
    return days?.[0]?.window ?? null;
  }

  /**
   * The resolved hours of every cinema date from `from` to `to` (both included, at most 31
   * dates), per theater, in date order. Every theater asked for is in the map.
   */
  async hoursFor(
    theaterIds: readonly number[],
    from: CalendarDate,
    to: CalendarDate,
  ): Promise<ReadonlyMap<number, readonly CinemaDateHours[]>> {
    if (!isCalendarDate(from) || !isCalendarDate(to) || to < from) {
      throw new AppError('INTERNAL', 'hoursFor() needs two calendar dates in order.');
    }
    if (addDays(from, MAX_HOURS_RANGE_DAYS - 1) < to) {
      throw new AppError('INTERNAL', `hoursFor() answers at most ${MAX_HOURS_RANGE_DAYS} dates.`);
    }
    const ids = [...new Set(theaterIds)];
    // One after the other: inside a transaction both would share one connection.
    const weekly = await this.weeklyHours(ids);
    const specials = await this.specialDates(ids, from, to);
    const dates = cinemaDatesBetween(from, to);
    return new Map(
      ids.map((id) => {
        const days = weekly.get(id) ?? [];
        const special = specials.get(id) ?? [];
        return [id, dates.map((date) => resolveCinemaDateHours(date, days, special))];
      }),
    );
  }

  /** Whether each theater is open at `at`, with when it closes or next opens. */
  async openStates(
    theaterIds: readonly number[],
    at: Date,
  ): Promise<ReadonlyMap<number, OpenState>> {
    const { from, to } = openStateDates(at);
    const hours = await this.hoursFor(theaterIds, from, to);
    return new Map([...hours].map(([id, days]) => [id, openStateAt(at, days)]));
  }

  /** The weekly hours of each theater by weekday: 7 rows once set, none before. */
  async weeklyHours(theaterIds: readonly number[]): Promise<ReadonlyMap<number, DayHours[]>> {
    return groupByTheater(await this.hours.weeklyOf([...new Set(theaterIds)]), toDayHours);
  }

  /**
   * The special dates of each theater from `from` to `to` (both included; no upper bound when
   * `to` is null), by date.
   */
  async specialDates(
    theaterIds: readonly number[],
    from: CalendarDate,
    to: CalendarDate | null,
  ): Promise<ReadonlyMap<number, SpecialDate[]>> {
    const rows = await this.hours.specialDatesBetween([...new Set(theaterIds)], from, to);
    return groupByTheater(rows, toSpecialDate);
  }
}
