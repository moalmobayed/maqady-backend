import { Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import type { PageRequest } from '../../common/pagination/types';
import { HALL_SCHEDULE_LOCK_PREFIX } from './showtimes.constants';
import type {
  BusySlotRow,
  NewShowtimeRow,
  NextShowtimeFilter,
  ScheduledShowtimeFilter,
  ShowtimeRow,
  ShowtimeRowUpdate,
  TimelineFilter,
} from './types';

const SHOWTIME_COLUMNS = [
  'id',
  'movie_id',
  'theater_id',
  'hall_id',
  'starts_at',
  'ends_at',
  'cleaning_ends_at',
  'cinema_date',
  'price_front',
  'price_middle',
  'price_back',
  'currency',
  'seat_capacity',
  'status',
  'cancel_reason',
  'cancelled_at',
  'created_at',
  'updated_at',
] as const;

const BUSY_COLUMNS = ['id', 'movie_id', 'starts_at', 'ends_at', 'cleaning_ends_at'] as const;

const BY_START = [
  { column: 'starts_at', order: 'asc' },
  { column: 'id', order: 'asc' },
] as const;

/**
 * `showtimes` (design §6.2). Every read of many showtimes is one query (`whereIn`, ranges), and
 * every method runs on the current executor, so writes join the request transaction and the
 * savepoints `ShowtimesService` opens around each insert.
 */
@Injectable()
export class ShowtimesRepository {
  constructor(private readonly db: TransactionContext) {}

  /**
   * Queues this transaction behind any other scheduling write (create or move) of the hall,
   * until it ends: a transaction-scoped advisory lock, taken after the hall row's `FOR SHARE`.
   */
  async lockHallSchedule(hallId: number): Promise<void> {
    await this.db
      .executor()
      .raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`${HALL_SCHEDULE_LOCK_PREFIX}${hallId}`]);
  }

  /** Inserts a showtime; a gap violation raises `23P01` on `ex_showtimes_hall_cleaning_gap`. */
  async insert(row: NewShowtimeRow): Promise<ShowtimeRow> {
    const [inserted] = await this.showtimes()
      .insert(row)
      .returning<ShowtimeRow[]>(SHOWTIME_COLUMNS);
    if (!inserted) throw new AppError('INTERNAL', 'The showtime insert returned no row.');
    return inserted;
  }

  async findById(id: number): Promise<ShowtimeRow | undefined> {
    return this.showtimes().select<ShowtimeRow[]>(SHOWTIME_COLUMNS).where({ id }).first();
  }

  /** The showtime, locked `FOR UPDATE` until the transaction ends: a move, prices, a cancel. */
  async findByIdForUpdate(id: number): Promise<ShowtimeRow | undefined> {
    return this.showtimes()
      .select<ShowtimeRow[]>(SHOWTIME_COLUMNS)
      .where({ id })
      .forUpdate()
      .first();
  }

  /**
   * The showtime, locked `FOR SHARE` until the transaction ends: a hold reads it as bookable
   * (design §7.1 step 2). Moves, price changes and cancels (`FOR UPDATE`) wait for it.
   */
  async findByIdForShare(id: number): Promise<ShowtimeRow | undefined> {
    return this.showtimes()
      .select<ShowtimeRow[]>(SHOWTIME_COLUMNS)
      .where({ id })
      .forShare()
      .first();
  }

  /** Locks these showtimes `FOR SHARE` in id order (design §7.1 step 2) and returns them. */
  async findByIdsForShare(ids: readonly number[]): Promise<ShowtimeRow[]> {
    if (ids.length === 0) return [];
    return this.showtimes()
      .select<ShowtimeRow[]>(SHOWTIME_COLUMNS)
      .whereIn('id', [...new Set(ids)])
      .orderBy('id')
      .forShare();
  }

  /** These showtimes, by start then id; unknown ids are absent. */
  async findByIds(ids: readonly number[]): Promise<ShowtimeRow[]> {
    if (ids.length === 0) return [];
    return this.showtimes()
      .select<ShowtimeRow[]>(SHOWTIME_COLUMNS)
      .whereIn('id', [...ids])
      .orderBy([...BY_START]);
  }

  /** Updates a showtime; a move that breaks the gap raises `23P01` like an insert. */
  async update(id: number, changes: ShowtimeRowUpdate): Promise<ShowtimeRow> {
    const [updated] = await this.showtimes()
      .where({ id })
      .update(changes)
      .returning<ShowtimeRow[]>(SHOWTIME_COLUMNS);
    if (!updated) throw new AppError('INTERNAL', 'The showtime update returned no row.');
    return updated;
  }

  /**
   * The scheduled showtimes of a hall whose `[starts_at, cleaning_ends_at)` meets
   * `[from, to)`, by start: one query on the gist index of the exclusion constraint.
   */
  async overlapping(
    hallId: number,
    from: Date,
    to: Date,
    excludeId?: number,
  ): Promise<BusySlotRow[]> {
    const query = this.showtimes()
      .select<BusySlotRow[]>(BUSY_COLUMNS)
      .where({ hall_id: hallId, status: 'scheduled' })
      .whereRaw(
        'tstzrange(starts_at, cleaning_ends_at) && tstzrange(?::timestamptz, ?::timestamptz)',
        [from, to],
      )
      .orderBy([...BY_START]);
    if (excludeId !== undefined) query.whereNot({ id: excludeId });
    return query;
  }

  /** Up to `limit + 1` showtimes of one theater's cinema date after the cursor, by start, id. */
  async listTimeline(filter: TimelineFilter, page: PageRequest): Promise<ShowtimeRow[]> {
    const query = this.timeline(filter)
      .select<ShowtimeRow[]>(SHOWTIME_COLUMNS)
      .orderBy([...BY_START])
      .limit(page.limit + 1);
    if (page.after) {
      query.whereRaw('(starts_at, id) > (?::timestamptz, ?)', [page.after.sortKey, page.after.id]);
    }
    return query;
  }

  async countTimeline(filter: TimelineFilter): Promise<number> {
    const row = await this.timeline(filter).count<{ count: number }[]>({ count: 'id' }).first();
    return row?.count ?? 0;
  }

  /** The halls that have a showtime (any status) on a theater's cinema date. */
  async hallIdsOnDate(theaterId: number, cinemaDate: string): Promise<number[]> {
    const rows = await this.showtimes()
      .distinct<{ hall_id: number }[]>('hall_id')
      .where({ theater_id: theaterId, cinema_date: cinemaDate });
    return rows.map((row) => row.hall_id);
  }

  /** Scheduled showtimes matching the filter, by start then id (U8). */
  async listScheduled(filter: ScheduledShowtimeFilter): Promise<ShowtimeRow[]> {
    return this.scheduled(filter)
      .select<ShowtimeRow[]>(SHOWTIME_COLUMNS)
      .orderBy([...BY_START]);
  }

  /** Per movie, its first scheduled showtime on the cinema date after `after` (U8 ticker). */
  async nextScheduledPerMovie(filter: NextShowtimeFilter): Promise<ShowtimeRow[]> {
    const query = this.scheduled({
      from: filter.cinemaDate,
      to: filter.cinemaDate,
      startsAfter: filter.after,
      ...(filter.movieIds ? { movieIds: filter.movieIds } : {}),
      ...(filter.theaterIds ? { theaterIds: filter.theaterIds } : {}),
    })
      .distinctOn('movie_id')
      .select<ShowtimeRow[]>(SHOWTIME_COLUMNS)
      .orderBy([
        { column: 'movie_id', order: 'asc' },
        { column: 'starts_at', order: 'asc' },
        { column: 'id', order: 'asc' },
      ]);
    return query;
  }

  /** The movies with a scheduled showtime matching the filter (U8 "show date"). */
  async movieIdsScheduled(filter: ScheduledShowtimeFilter): Promise<number[]> {
    const rows = await this.scheduled(filter).distinct<{ movie_id: number }[]>('movie_id');
    return rows.map((row) => row.movie_id);
  }

  /**
   * Locks the hall's scheduled showtimes that start after `now` `FOR UPDATE`, in id order: a
   * layout save takes them before the hall (design §7.1, "showtime before hall").
   */
  async lockFutureInHall(hallId: number, now: Date): Promise<void> {
    await this.showtimes()
      .select('id')
      .where({ hall_id: hallId, status: 'scheduled' })
      .andWhere('starts_at', '>', now)
      .orderBy('id')
      .forUpdate();
  }

  /** Sets the seat capacity of the hall's scheduled showtimes that start after `now`. */
  async refreshCapacity(hallId: number, seatCount: number, now: Date): Promise<number> {
    return this.showtimes()
      .where({ hall_id: hallId, status: 'scheduled' })
      .andWhere('starts_at', '>', now)
      .update({ seat_capacity: seatCount, updated_at: now });
  }

  /** The ids among `hallIds` that have ever had a showtime, in any status. */
  async hallIdsWithShowtimes(hallIds: readonly number[]): Promise<number[]> {
    if (hallIds.length === 0) return [];
    const rows = await this.showtimes()
      .distinct<{ hall_id: number }[]>('hall_id')
      .whereIn('hall_id', [...hallIds]);
    return rows.map((row) => row.hall_id);
  }

  /** The ids among `hallIds` with a scheduled showtime that has not ended at `now`. */
  async hallIdsWithUnendedShowtimes(hallIds: readonly number[], now: Date): Promise<number[]> {
    if (hallIds.length === 0) return [];
    const rows = await this.showtimes()
      .distinct<{ hall_id: number }[]>('hall_id')
      .whereIn('hall_id', [...hallIds])
      .andWhere({ status: 'scheduled' })
      .andWhere('ends_at', '>', now);
    return rows.map((row) => row.hall_id);
  }

  /** The hall's scheduled showtimes that have not ended at `now`, by start then id. */
  async listUnendedInHall(hallId: number, now: Date): Promise<ShowtimeRow[]> {
    return this.showtimes()
      .select<ShowtimeRow[]>(SHOWTIME_COLUMNS)
      .where({ hall_id: hallId, status: 'scheduled' })
      .andWhere('ends_at', '>', now)
      .orderBy([...BY_START]);
  }

  /** True when the theater has ever had a showtime. */
  async existsForTheater(theaterId: number): Promise<boolean> {
    const row = await this.showtimes()
      .select<{ id: number }[]>('id')
      .where({ theater_id: theaterId })
      .first();
    return row !== undefined;
  }

  /** True when the movie has ever had a showtime. */
  async existsForMovie(movieId: number): Promise<boolean> {
    const row = await this.showtimes()
      .select<{ id: number }[]>('id')
      .where({ movie_id: movieId })
      .first();
    return row !== undefined;
  }

  private timeline(filter: TimelineFilter): Knex.QueryBuilder {
    const query = this.showtimes().where({
      theater_id: filter.theaterId,
      cinema_date: filter.cinemaDate,
    });
    if (filter.hallId !== undefined) query.andWhere({ hall_id: filter.hallId });
    if (filter.status !== undefined) query.andWhere({ status: filter.status });
    return query;
  }

  private scheduled(filter: ScheduledShowtimeFilter): Knex.QueryBuilder {
    const query = this.showtimes()
      .where({ status: 'scheduled' })
      .andWhereBetween('cinema_date', [filter.from, filter.to]);
    if (filter.movieIds) query.whereIn('movie_id', [...filter.movieIds]);
    if (filter.theaterIds) query.whereIn('theater_id', [...filter.theaterIds]);
    if (filter.startsAfter) query.andWhere('starts_at', '>', filter.startsAfter);
    return query;
  }

  private showtimes(): Knex.QueryBuilder {
    return this.db.executor()('showtimes');
  }
}
