import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { money } from '../../common/money/money';
import type { Money } from '../../common/money/types';
import { Clock } from '../../common/time/clock';
import { addDays, cinemaDateOf } from '../../common/time/time';
import type { CalendarDate } from '../../common/time/types';
import { CatalogReadService } from '../catalog/catalog-read.service';
import { isPublicStatus } from '../catalog/movie-rules';
import type { MovieSummary } from '../catalog/types';
import { ShowtimeReadService } from '../showtimes/showtime-read.service';
import type { ShowtimeView } from '../showtimes/types';
import { TheaterReadService } from '../theaters/theater-read.service';
import type { TheaterDetails } from '../theaters/types';
import { SHOWTIME_DAYS } from './discovery.constants';
import { compareByNameThenId } from './in-memory-page';
import { cinemaDatesFrom, showDateRange } from './show-dates';
import type {
  MovieShowtimeDay,
  MovieShowtimeSummary,
  MovieShowtimesView,
  PublicMovieRef,
  PublicShowtimeView,
  ShowDate,
  ShowtimeTheaterRef,
  TheaterShowtimeCount,
  TheaterShowtimeDay,
  TheaterShowtimesView,
} from './types';

/**
 * Showtimes as customers browse them (PRD C1–C3, C5), read through U7's `ShowtimeReadService`.
 * A customer sees a showtime only when it is scheduled, its theater is `active` (the theater ids
 * passed to every read) and its movie is Now showing; lists group by the stored cinema date, so
 * a 00:30 show is under the previous date. Lists leave out showtimes that have ended and mark
 * the started ones; the side panel and the "show date" filter count only those still to start.
 * Every method costs a fixed number of queries, one after the other.
 */
@Injectable()
export class ShowtimeBrowseService {
  constructor(
    private readonly showtimes: ShowtimeReadService,
    private readonly theaters: TheaterReadService,
    private readonly catalog: CatalogReadService,
    private readonly clock: Clock,
  ) {}

  /**
   * `GET /movies/{id}/showtimes`: the 7 cinema days from today's, theaters by name within a day,
   * and the theater picker. A Coming soon movie has none; a movie that isn't public is
   * `NOT_FOUND`.
   */
  async movieShowtimes(movieId: number): Promise<MovieShowtimesView> {
    const now = this.clock.now();
    const today = cinemaDateOf(now);
    const dates = cinemaDatesFrom(today, SHOWTIME_DAYS);
    const movie = (await this.catalog.findMoviesByIds([movieId])).get(movieId);
    if (!movie || !isPublicStatus(movie.status)) throw new AppError('NOT_FOUND');

    let listed: PublicShowtimeView[] = [];
    let theaters = new Map<number, TheaterDetails>();
    if (movie.status === 'now_showing') {
      theaters = await this.activeTheaters();
      const views = await this.scheduled([movieId], [...theaters.keys()], today, dates.at(-1)!);
      listed = notEnded(views, now);
    }

    const days: MovieShowtimeDay[] = dates.map((cinemaDate) => {
      const ofDay = listed.filter((showtime) => showtime.cinemaDate === cinemaDate);
      const groups = groupBy(ofDay, (showtime) => showtime.theaterId);
      return {
        cinemaDate,
        showtimeCount: ofDay.length,
        theaters: [...groups.entries()]
          .map(([theaterId, showtimes]) => ({
            theater: theaterRef(theaters.get(theaterId)!),
            showtimes,
          }))
          .sort((first, second) => compareByNameThenId(first.theater, second.theater)),
      };
    });
    const picker: TheaterShowtimeCount[] = [...groupBy(listed, (row) => row.theaterId).entries()]
      .map(([theaterId, showtimes]) => ({
        ...theaterRef(theaters.get(theaterId)!),
        showtimeCount: showtimes.length,
      }))
      .sort(compareByNameThenId);
    return { movieId, cinemaDate: today, theaters: picker, days };
  }

  /**
   * `GET /theaters/{id}/showtimes`: the 7 cinema days from today's, or only `date`; movies by
   * their first showtime of the day, then id. A date outside the 7 days has no movies; a theater
   * that isn't `active` is `NOT_FOUND`.
   */
  async theaterShowtimes(theaterId: number, date?: CalendarDate): Promise<TheaterShowtimesView> {
    const now = this.clock.now();
    const today = cinemaDateOf(now);
    const theater = await this.theaters.findActive(theaterId);
    if (!theater) throw new AppError('NOT_FOUND');

    const window = cinemaDatesFrom(today, SHOWTIME_DAYS);
    const dates = date === undefined ? window : [date];
    const readable = dates.filter((cinemaDate) => window.includes(cinemaDate));
    let listed: PublicShowtimeView[] = [];
    let movies = new Map<number, MovieSummary>();
    if (readable.length > 0) {
      const views = await this.scheduled(undefined, [theaterId], readable[0]!, readable.at(-1)!);
      movies = await this.nowShowing(views.map((view) => view.movieId));
      listed = notEnded(views, now).filter((showtime) => movies.has(showtime.movieId));
    }

    const days: TheaterShowtimeDay[] = dates.map((cinemaDate) => {
      const ofDay = listed.filter((showtime) => showtime.cinemaDate === cinemaDate);
      // `ofDay` is by start then id, so each group's first showtime is its earliest and the
      // groups come out in the order of their first showtime.
      return {
        cinemaDate,
        movies: [...groupBy(ofDay, (showtime) => showtime.movieId).entries()].map(
          ([movieId, showtimes]) => ({ movie: movies.get(movieId)!, showtimes }),
        ),
      };
    });
    return { theaterId, cinemaDate: today, days };
  }

  /**
   * The movie page's side panel (PRD C3): its next showtime of today's cinema date still to
   * start, how many active theaters have one still to start in the 7 days, and the lowest
   * "from" price among those. Empty for a Coming soon movie.
   */
  async summaryOf(movie: PublicMovieRef): Promise<MovieShowtimeSummary> {
    if (movie.status !== 'now_showing') return EMPTY_SUMMARY;
    const now = this.clock.now();
    const today = cinemaDateOf(now);
    const theaters = await this.activeTheaters();
    const upcoming = await this.scheduled(
      [movie.id],
      [...theaters.keys()],
      today,
      addDays(today, SHOWTIME_DAYS - 1),
      now,
    );
    if (upcoming.length === 0) return EMPTY_SUMMARY;
    const next = upcoming.find((showtime) => showtime.cinemaDate === today);
    return {
      nextShowToday: next
        ? { showtime: next, theater: theaterRef(theaters.get(next.theaterId)!) }
        : null,
      cinemaCount: new Set(upcoming.map((showtime) => showtime.theaterId)).size,
      fromPrice: lowest(upcoming.map((showtime) => showtime.fromPrice)),
    };
  }

  /**
   * The movies with a scheduled showtime of an active theater on the "show date"'s cinema dates
   * that starts after now (the Movies page filter, PRD C2), in id order.
   */
  async movieIdsShowing(showDate: ShowDate): Promise<readonly number[]> {
    const now = this.clock.now();
    const range = showDateRange(showDate, cinemaDateOf(now));
    const theaters = await this.activeTheaters();
    if (theaters.size === 0) return [];
    const ids = await this.showtimes.movieIdsScheduled({
      ...range,
      theaterIds: [...theaters.keys()],
      startsAfter: now,
    });
    return [...ids].sort((first, second) => first - second);
  }

  /** The active theaters, by id. */
  private async activeTheaters(): Promise<Map<number, TheaterDetails>> {
    return new Map((await this.theaters.listActive()).map((theater) => [theater.id, theater]));
  }

  /** Scheduled showtimes of these theaters (and movies) on the dates, by start then id. */
  private async scheduled(
    movieIds: readonly number[] | undefined,
    theaterIds: readonly number[],
    from: CalendarDate,
    to: CalendarDate,
    startsAfter?: Date,
  ): Promise<readonly ShowtimeView[]> {
    if (theaterIds.length === 0) return [];
    return this.showtimes.listScheduled({
      from,
      to,
      theaterIds,
      ...(movieIds === undefined ? {} : { movieIds }),
      ...(startsAfter === undefined ? {} : { startsAfter }),
    });
  }

  /** The Now showing movies among `ids`, as cards; others are absent. */
  private async nowShowing(ids: readonly number[]): Promise<Map<number, MovieSummary>> {
    if (ids.length === 0) return new Map();
    const found = await this.catalog.findPublicMoviesByIds(ids);
    return new Map([...found].filter(([, movie]) => movie.status === 'now_showing'));
  }
}

const EMPTY_SUMMARY: MovieShowtimeSummary = {
  nextShowToday: null,
  cinemaCount: 0,
  fromPrice: null,
};

/** The showtimes that have not ended at `now`, each marked started or not. */
function notEnded(views: readonly ShowtimeView[], now: Date): PublicShowtimeView[] {
  return views
    .filter((view) => view.endsAt.getTime() > now.getTime())
    .map((view) => ({ ...view, hasStarted: view.startsAt.getTime() <= now.getTime() }));
}

/** Groups in the order each key is first seen, each group keeping the input order. */
function groupBy<T>(items: readonly T[], keyOf: (item: T) => number): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

function theaterRef(theater: TheaterDetails): ShowtimeTheaterRef {
  return { id: theater.id, name: theater.name, district: theater.district, city: theater.city };
}

/** The lowest of several prices (all EGP in v1); null for none. */
function lowest(prices: readonly Money[]): Money | null {
  if (prices.length === 0) return null;
  const cheapest = prices.reduce((low, price) => (price.amount < low.amount ? price : low));
  return money(cheapest.amount, cheapest.currency);
}
