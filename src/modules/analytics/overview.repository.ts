import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../../common/database/transaction-context';
import type { CalendarDate } from '../../common/time/types';
import type {
  DailyRevenueRow,
  MethodSplitRow,
  NamedRow,
  ShowtimeAggregateRow,
  TheaterScopeSql,
  TonightRow,
} from './types';

/**
 * The Overview's reads (U17; design §5: `analytics` is a read-only module with its own aggregate
 * queries over the tables it reports on, §13.3). Every method is one statement on the current
 * executor; nothing here writes. Revenue and tickets are the Confirmed and Completed bookings
 * (stored `confirmed`) of a showtime, counted on the showtime's `cinema_date`; all money is EGP.
 *
 * `theaterId` is a bound value; with it every query reads that theater's showtimes only
 * (`idx_showtimes_theater_id_cinema_date_starts_at`), without it every theater's
 * (`idx_showtimes_cinema_date_starts_at`). Bookings are reached by
 * `idx_bookings_showtime_id_status`, payments by `idx_payments_booking_id_created_at`.
 */
@Injectable()
export class OverviewRepository {
  constructor(private readonly db: TransactionContext) {}

  /**
   * One row per showtime whose cinema date falls in `[dateFrom, dateTo]` (both included), any
   * status, with the totals and seats of its Confirmed and Completed bookings, in id order.
   */
  async showtimeAggregates(
    dateFrom: CalendarDate,
    dateTo: CalendarDate,
    theaterId: number | undefined,
  ): Promise<ShowtimeAggregateRow[]> {
    const scope = theaterScope(theaterId);
    const result = await this.db.executor().raw<{ rows: ShowtimeAggregateRow[] }>(
      `SELECT s.id AS showtime_id, s.theater_id, s.hall_id, s.movie_id, s.cinema_date,
              s.starts_at, s.status, s.seat_capacity,
              COALESCE(SUM(b.total_amount), 0) AS revenue,
              COALESCE(SUM(b.seat_count), 0) AS tickets
       FROM showtimes AS s
       LEFT JOIN bookings AS b ON b.showtime_id = s.id AND b.status = 'confirmed'
       WHERE s.cinema_date >= ? AND s.cinema_date <= ?${scope.sql}
       GROUP BY s.id
       ORDER BY s.id`,
      [dateFrom, dateTo, ...scope.bindings],
    );
    return result.rows;
  }

  /**
   * The money of the period's Confirmed and Completed bookings by their showtime's theater and the
   * payment method: succeeded charges minus every refund (a pending counter refund is owed, so it
   * counts), so a consistent ledger's methods add up to the bookings' totals (the U16
   * reconciliation flags one that does not).
   */
  async methodSplit(
    dateFrom: CalendarDate,
    dateTo: CalendarDate,
    theaterId: number | undefined,
  ): Promise<MethodSplitRow[]> {
    const scope = theaterScope(theaterId);
    const result = await this.db.executor().raw<{ rows: MethodSplitRow[] }>(
      `SELECT s.theater_id, p.method,
              COALESCE(SUM(CASE
                WHEN p.kind = 'charge' AND p.status = 'succeeded' THEN p.amount
                WHEN p.kind = 'refund' THEN -p.amount
                ELSE 0 END), 0) AS amount
       FROM showtimes AS s
       JOIN bookings AS b ON b.showtime_id = s.id AND b.status = 'confirmed'
       JOIN payments AS p ON p.booking_id = b.id
       WHERE s.cinema_date >= ? AND s.cinema_date <= ?${scope.sql}
       GROUP BY s.theater_id, p.method
       ORDER BY s.theater_id, p.method`,
      [dateFrom, dateTo, ...scope.bindings],
    );
    return result.rows;
  }

  /** The revenue of each theater on each cinema date of `[dateFrom, dateTo]` that had some. */
  async dailyRevenue(
    dateFrom: CalendarDate,
    dateTo: CalendarDate,
    theaterId: number | undefined,
  ): Promise<DailyRevenueRow[]> {
    const scope = theaterScope(theaterId);
    const result = await this.db.executor().raw<{ rows: DailyRevenueRow[] }>(
      `SELECT s.cinema_date, s.theater_id, SUM(b.total_amount) AS revenue
       FROM showtimes AS s
       JOIN bookings AS b ON b.showtime_id = s.id AND b.status = 'confirmed'
       WHERE s.cinema_date >= ? AND s.cinema_date <= ?${scope.sql}
       GROUP BY s.cinema_date, s.theater_id
       ORDER BY s.cinema_date, s.theater_id`,
      [dateFrom, dateTo, ...scope.bindings],
    );
    return result.rows;
  }

  /**
   * "Tonight": up to `limit` scheduled showtimes of `cinemaDate` that end after `now`, soonest
   * first (then id), with their names, what they sold, and how many match in all.
   */
  async tonight(
    cinemaDate: CalendarDate,
    now: Date,
    theaterId: number | undefined,
    limit: number,
  ): Promise<TonightRow[]> {
    const scope = theaterScope(theaterId);
    const result = await this.db.executor().raw<{ rows: TonightRow[] }>(
      `SELECT s.id AS showtime_id, s.starts_at, s.ends_at, s.cinema_date, s.seat_capacity,
              s.theater_id, t.name AS theater_name, s.hall_id, h.name AS hall_name,
              s.movie_id, m.title AS movie_title,
              COALESCE(SUM(b.seat_count), 0) AS tickets,
              COALESCE(SUM(b.total_amount), 0) AS revenue,
              COUNT(*) OVER () AS total_count
       FROM showtimes AS s
       JOIN theaters AS t ON t.id = s.theater_id
       JOIN halls AS h ON h.id = s.hall_id
       JOIN movies AS m ON m.id = s.movie_id
       LEFT JOIN bookings AS b ON b.showtime_id = s.id AND b.status = 'confirmed'
       WHERE s.cinema_date = ? AND s.status = 'scheduled' AND s.ends_at > ?${scope.sql}
       GROUP BY s.id, t.name, h.name, m.title
       ORDER BY s.starts_at, s.id
       LIMIT ?`,
      [cinemaDate, now, ...scope.bindings, limit],
    );
    return result.rows;
  }

  /** A theater's id and name, or undefined when there is none with that id. */
  async findTheater(id: number): Promise<NamedRow | undefined> {
    return this.db.executor()('theaters').select<NamedRow[]>('id', 'name').where({ id }).first();
  }

  /** The names of these theaters (`theaters_pkey`). */
  async theaterNames(ids: readonly number[]): Promise<NamedRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .executor()('theaters')
      .select<NamedRow[]>('id', 'name')
      .whereIn('id', [...ids]);
  }

  /** The names of these halls (`halls_pkey`). */
  async hallNames(ids: readonly number[]): Promise<NamedRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .executor()('halls')
      .select<NamedRow[]>('id', 'name')
      .whereIn('id', [...ids]);
  }

  /** The titles of these movies, as names (`movies_pkey`). */
  async movieTitles(ids: readonly number[]): Promise<NamedRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .executor()('movies')
      .select<NamedRow[]>('id', 'title as name')
      .whereIn('id', [...ids]);
  }
}

/** ` AND s.theater_id = ?` with its binding, or nothing for every theater. */
function theaterScope(theaterId: number | undefined): TheaterScopeSql {
  return theaterId === undefined
    ? { sql: '', bindings: [] }
    : { sql: ' AND s.theater_id = ?', bindings: [theaterId] };
}
