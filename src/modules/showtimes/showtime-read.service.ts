import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { addDays, isCalendarDate } from '../../common/time/time';
import { CatalogReadService } from '../catalog/catalog-read.service';
import { HallReadService } from '../halls/hall-read.service';
import type { HallBlockingShowtime } from '../halls/types';
import { toShowtimeView } from './showtime-rows';
import { MAX_READ_RANGE_DAYS } from './showtimes.constants';
import { ShowtimesRepository } from './showtimes.repository';
import type {
  NextShowtimeFilter,
  ScheduledShowtimeFilter,
  ShowtimeRow,
  ShowtimeView,
} from './types';

/**
 * Showtimes as other units read them (exported by `ShowtimesModule`), so no other module
 * touches the `showtimes` table (design §5):
 *
 * - U8 discovery: `listScheduled()` by movie and by theater over up to 31 cinema dates,
 *   `nextScheduledPerMovie()` for the home ticker, `movieIdsScheduled()` for the "show date"
 *   filter. They return scheduled showtimes of any theater asked for; U8 passes the `active`
 *   theaters and hides started ones itself, from the same `Clock`.
 * - U10 holds and the public showtime page: `findById()` in any status.
 * - U10's seat claims: `listUnendedInHall()`.
 *
 * Every read costs a fixed number of queries whatever the number of showtimes: one for the
 * showtimes, then three for their halls (names and the zone seat counts of the "from" price).
 */
@Injectable()
export class ShowtimeReadService {
  constructor(
    private readonly showtimes: ShowtimesRepository,
    private readonly halls: HallReadService,
    private readonly catalog: CatalogReadService,
    private readonly clock: Clock,
  ) {}

  /** A showtime in any status; null when there is none. */
  async findById(id: number): Promise<ShowtimeView | null> {
    const row = await this.showtimes.findById(id);
    if (!row) return null;
    return (await this.viewsOf([row]))[0] ?? null;
  }

  /** These showtimes in any status, by id; unknown ids are absent. */
  async findByIds(ids: readonly number[]): Promise<ReadonlyMap<number, ShowtimeView>> {
    const views = await this.viewsOf(await this.showtimes.findByIds([...new Set(ids)]));
    return new Map(views.map((view) => [view.id, view]));
  }

  /**
   * Scheduled showtimes on cinema dates `from` to `to` (both included, at most 31 dates), by
   * start then id, optionally only of `movieIds`, of `theaterIds`, and starting after
   * `startsAfter`. An empty id list matches nothing.
   */
  async listScheduled(filter: ScheduledShowtimeFilter): Promise<readonly ShowtimeView[]> {
    checkRange(filter.from, filter.to);
    return this.viewsOf(await this.showtimes.listScheduled(filter));
  }

  /**
   * For each movie with a scheduled showtime on `cinemaDate` starting after `after`, the first
   * one (then the lowest id), by movie id (U8's home ticker).
   */
  async nextScheduledPerMovie(
    filter: NextShowtimeFilter,
  ): Promise<ReadonlyMap<number, ShowtimeView>> {
    checkRange(filter.cinemaDate, filter.cinemaDate);
    const views = await this.viewsOf(await this.showtimes.nextScheduledPerMovie(filter));
    return new Map(views.map((view) => [view.movieId, view]));
  }

  /** The movies with a scheduled showtime matching the filter (U8's "show date" filter). */
  async movieIdsScheduled(filter: ScheduledShowtimeFilter): Promise<ReadonlySet<number>> {
    checkRange(filter.from, filter.to);
    return new Set(await this.showtimes.movieIdsScheduled(filter));
  }

  /**
   * The hall's scheduled showtimes that have not ended, by start, with their movie titles: what
   * can keep its layout from changing (`HALL_IN_USE`, judged by U10's seat claims).
   */
  async listUnendedInHall(hallId: number): Promise<readonly HallBlockingShowtime[]> {
    const rows = await this.showtimes.listUnendedInHall(hallId, this.clock.now());
    if (rows.length === 0) return [];
    const movies = await this.catalog.findMoviesByIds(rows.map((row) => row.movie_id));
    return rows.map((row) => ({
      showtimeId: row.id,
      startsAt: row.starts_at,
      movieTitle: movies.get(row.movie_id)?.title ?? '',
    }));
  }

  /** Views of these rows, in their order, in three hall queries whatever their number. */
  async viewsOf(rows: readonly ShowtimeRow[]): Promise<ShowtimeView[]> {
    if (rows.length === 0) return [];
    const halls = await this.halls.findByIds(rows.map((row) => row.hall_id));
    return rows.map((row) => toShowtimeView(row, halls.get(row.hall_id)));
  }
}

function checkRange(from: string, to: string): void {
  if (!isCalendarDate(from) || !isCalendarDate(to) || to < from) {
    throw new AppError('INTERNAL', 'Showtime reads need two calendar dates in order.');
  }
  if (addDays(from, MAX_READ_RANGE_DAYS - 1) < to) {
    throw new AppError('INTERNAL', `Showtime reads answer at most ${MAX_READ_RANGE_DAYS} dates.`);
  }
}
