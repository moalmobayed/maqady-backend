import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { addToInstant, cinemaDayBounds } from '../../common/time/time';
import type { CalendarDate } from '../../common/time/types';
import { CatalogReadService } from '../catalog/catalog-read.service';
import type { MovieSchedulingInfo } from '../catalog/types';
import { HallReadService } from '../halls/hall-read.service';
import { TheaterHoursService } from '../theaters/theater-hours.service';
import { TheaterReadService } from '../theaters/theater-read.service';
import type { OpeningWindow } from '../theaters/types';
import { toBusySlot } from './showtime-rows';
import {
  fitsWindow,
  overlaps,
  showtimeSpan,
  startInstantOrNull,
  suggestStarts,
} from './showtime-time';
import { CLEANING_GAP_MINUTES } from './showtimes.constants';
import { ShowtimesRepository } from './showtimes.repository';
import type {
  BusySlot,
  DateCheck,
  DateCheckOptions,
  NotSchedulableReason,
  SchedulingTarget,
  ShowtimeConflict,
  ShowtimeSpan,
} from './types';

/**
 * The scheduling checks (design §8) that the dry run, the batch create and the move share:
 *
 * 1. resolve the movie, hall and theater, without locks for the dry run, or for a write locked
 *    in the order theater `FOR SHARE` → movie `FOR SHARE` → hall `FOR SHARE` (design §7.1, §9);
 * 2. whether they can be scheduled at all (`SHOWTIME_NOT_SCHEDULABLE`);
 * 3. per cinema date, in this order, the first failure winning: the start exists that night, is
 *    after now, starts and ends inside the date's opening window, and keeps 20 minutes from every
 *    other scheduled showtime in the hall.
 *
 * Every date of a request is checked from one hours read and one conflict query: no query per
 * date. For writes the conflict check here is a forecast; the exclusion constraint decides.
 */
@Injectable()
export class ShowtimeSchedulingService {
  constructor(
    private readonly showtimes: ShowtimesRepository,
    private readonly theaters: TheaterReadService,
    private readonly hours: TheaterHoursService,
    private readonly halls: HallReadService,
    private readonly catalog: CatalogReadService,
  ) {}

  /** The dry run's movie, hall and theater, read without locks; `NOT_FOUND` for an unknown id. */
  async resolveForRead(movieId: number, hallId: number): Promise<SchedulingTarget> {
    const hall = await this.halls.findById(hallId);
    if (!hall) throw notFound('hall');
    const theater = await this.theaters.findById(hall.theaterId);
    if (!theater) throw notFound('hall');
    const movie = (await this.catalog.findMoviesByIds([movieId])).get(movieId);
    if (!movie) throw notFound('movie');
    return {
      hall,
      theater,
      movie: {
        id: movie.id,
        title: movie.title,
        status: movie.status,
        runtimeMinutes: movie.runtimeMinutes,
      },
    };
  }

  /**
   * A write's movie, hall and theater, locked in the open transaction: theater `FOR SHARE`, movie
   * `FOR SHARE`, hall `FOR SHARE`. Publishing, pausing or re-hours the theater, archiving the
   * movie and retiring the hall or replacing its layout wait until the write commits, and the
   * write sees what they committed before it.
   */
  async resolveForWrite(movieId: number, hallId: number): Promise<SchedulingTarget> {
    const unlocked = await this.halls.findById(hallId);
    if (!unlocked) throw notFound('hall');
    const theater = await this.theaters.lockForShare(unlocked.theaterId);
    if (!theater) throw notFound('hall');
    const movie = await this.catalog.lockMovieForShare(movieId);
    if (!movie) throw notFound('movie');
    const hall = await this.halls.lockForShare(hallId);
    if (!hall) throw notFound('hall');
    return { movie, hall, theater };
  }

  /**
   * Why the movie and hall can't be scheduled (design §8): only a Now showing movie in an active
   * hall, and only with prices (the request's, or the theater's defaults). Empty when they can.
   */
  notSchedulableReasons(target: SchedulingTarget, pricesGiven: boolean): NotSchedulableReason[] {
    const reasons: NotSchedulableReason[] = [];
    if (target.movie.status !== 'now_showing') reasons.push('movie_not_now_showing');
    if (target.hall.status !== 'active') reasons.push('hall_not_active');
    if (!pricesGiven && !target.theater.defaultPrices) reasons.push('no_prices');
    return reasons;
  }

  /** Throws `SHOWTIME_NOT_SCHEDULABLE` with `details.reasons` unless the target can be scheduled. */
  assertSchedulable(target: SchedulingTarget, pricesGiven: boolean): void {
    const reasons = this.notSchedulableReasons(target, pricesGiven);
    if (reasons.length > 0) throw new AppError('SHOWTIME_NOT_SCHEDULABLE', undefined, { reasons });
  }

  /**
   * Checks `startTime` on each of `dates` (sorted, unique) for the target's movie and hall, in
   * date order. One hours read and one conflict query for all of them; `excludeShowtimeId` leaves
   * a moving showtime out of its own conflicts.
   */
  async checkDates(
    target: SchedulingTarget,
    dates: readonly CalendarDate[],
    startTime: string,
    options: DateCheckOptions & { readonly excludeShowtimeId?: number },
  ): Promise<DateCheck[]> {
    const sorted = [...new Set(dates)].sort();
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (first === undefined || last === undefined) return [];
    const runtime = runtimeOf(target.movie);

    const hours = (await this.hours.hoursFor([target.theater.id], first, last)).get(
      target.theater.id,
    );
    const windows = new Map((hours ?? []).map((day) => [day.cinemaDate, day.window]));
    const busy = await this.busySlots(
      target.hall.id,
      cinemaDayBounds(first).startsAt,
      addToInstant(cinemaDayBounds(last).endsAt, { minutes: CLEANING_GAP_MINUTES }),
      options.excludeShowtimeId,
    );
    const titles = await this.titlesOf(busy);

    // The dates of one request never overlap one another: the same wall-clock start on two
    // cinema dates is at least 23 hours apart, and a runtime is at most 600 minutes.
    return sorted.map((cinemaDate) =>
      this.checkOne(
        cinemaDate,
        startTime,
        runtime,
        windows.get(cinemaDate) ?? null,
        busy,
        titles,
        options,
      ),
    );
  }

  /**
   * The scheduled showtimes of the hall that `span` would overlap, cleaning included, named with
   * their movies: the follow-up query after the constraint refused a write (design §8).
   */
  async conflictsWith(
    hallId: number,
    span: ShowtimeSpan,
    excludeShowtimeId?: number,
  ): Promise<ShowtimeConflict[]> {
    const busy = await this.busySlots(
      hallId,
      span.startsAt,
      span.cleaningEndsAt,
      excludeShowtimeId,
    );
    return this.namedConflicts(overlaps(span, busy), await this.titlesOf(busy));
  }

  private checkOne(
    cinemaDate: CalendarDate,
    startTime: string,
    runtime: number,
    window: OpeningWindow | null,
    busy: readonly BusySlot[],
    titles: ReadonlyMap<number, string>,
    options: DateCheckOptions,
  ): DateCheck {
    const suggestions = (): DateCheck['suggestions'] =>
      options.withSuggestions
        ? suggestStarts({
            cinemaDate,
            requestedTime: startTime,
            runtimeMinutes: runtime,
            window,
            busy,
            now: options.now,
          })
        : [];
    const startsAt = startInstantOrNull(cinemaDate, startTime);
    if (!startsAt) {
      return {
        cinemaDate,
        result: 'time_does_not_exist',
        span: null,
        window,
        conflicts: [],
        suggestions: suggestions(),
      };
    }
    const span = showtimeSpan(startsAt, runtime);
    const failure = (
      result: DateCheck['result'],
      conflicts: ShowtimeConflict[] = [],
    ): DateCheck => ({
      cinemaDate,
      result,
      span,
      window,
      conflicts,
      suggestions: suggestions(),
    });
    if (startsAt.getTime() <= options.now.getTime()) return failure('in_past');
    if (!fitsWindow(span, window)) return failure('outside_opening_hours');
    const conflicts = this.namedConflicts(overlaps(span, busy), titles);
    if (conflicts.length > 0) return failure('conflict', conflicts);
    return { cinemaDate, result: 'available', span, window, conflicts: [], suggestions: [] };
  }

  private async busySlots(
    hallId: number,
    from: Date,
    to: Date,
    excludeShowtimeId?: number,
  ): Promise<BusySlot[]> {
    const rows = await this.showtimes.overlapping(hallId, from, to, excludeShowtimeId);
    return rows.map(toBusySlot);
  }

  private async titlesOf(busy: readonly BusySlot[]): Promise<ReadonlyMap<number, string>> {
    if (busy.length === 0) return new Map();
    const movies = await this.catalog.findMoviesByIds(busy.map((slot) => slot.movieId));
    return new Map([...movies].map(([id, movie]) => [id, movie.title]));
  }

  private namedConflicts(
    slots: readonly BusySlot[],
    titles: ReadonlyMap<number, string>,
  ): ShowtimeConflict[] {
    return slots.map((slot) => ({
      showtimeId: slot.id,
      movieTitle: titles.get(slot.movieId) ?? '',
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      cleaningEndsAt: slot.cleaningEndsAt,
    }));
  }
}

/** A Now showing movie always has a runtime (`chk_movies_public_fields`); a draft may not. */
export function runtimeOf(movie: MovieSchedulingInfo): number {
  if (movie.runtimeMinutes === null) {
    throw new AppError('SHOWTIME_NOT_SCHEDULABLE', undefined, {
      reasons: ['movie_not_now_showing'],
    });
  }
  return movie.runtimeMinutes;
}

function notFound(entity: 'movie' | 'hall'): AppError {
  return new AppError('NOT_FOUND', undefined, { entity });
}
