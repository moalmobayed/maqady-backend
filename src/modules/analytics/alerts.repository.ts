import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../../common/database/transaction-context';
import type { CalendarDate } from '../../common/time/types';
import { ONLINE_PAYMENT_METHODS } from '../payments/enums';
import type { InstantRange } from '../payments/types';
import type { AlertReadRow, HallGapRow, LowSalesRow } from './types';

/**
 * The bell's reads and its read state (U17; design §13.3 "Alerts", §6.2 `staff_alert_reads`).
 * The conditions are read from `payments`, `showtimes`, `bookings`, `halls`, `theaters` and
 * `movies` in this read-only module's own queries (design §5); the only table written is
 * `staff_alert_reads`, which this module owns. Every method is one statement on the current
 * executor.
 */
@Injectable()
export class AlertsRepository {
  constructor(private readonly db: TransactionContext) {}

  /**
   * How many online charges (card, wallet) were declined, or closed by the customer at the
   * wallet, with their result in `[from, to)` (`idx_payments_completed_at`): the Payments
   * screen's "Failed today", online only.
   */
  async failedOnlineChargeCount(range: InstantRange): Promise<number> {
    const row = await this.db
      .executor()('payments')
      .count<{ count: number }[]>({ count: 'id' })
      .where('kind', 'charge')
      .whereIn('method', [...ONLINE_PAYMENT_METHODS])
      .whereIn('status', ['declined', 'cancelled'])
      .where('completed_at', '>=', range.from)
      .where('completed_at', '<', range.to)
      .first();
    return row?.count ?? 0;
  }

  /**
   * The scheduled showtimes of `cinemaDate` that start after `now` with fewer than
   * `thresholdPercent` of their seats in Confirmed bookings, soonest first, with their names
   * (`idx_showtimes_cinema_date_starts_at`, `idx_bookings_showtime_id_status`).
   */
  async lowSalesShowtimes(
    cinemaDate: CalendarDate,
    now: Date,
    thresholdPercent: number,
  ): Promise<LowSalesRow[]> {
    const result = await this.db.executor().raw<{ rows: LowSalesRow[] }>(
      `SELECT s.id AS showtime_id, s.starts_at, s.seat_capacity,
              s.theater_id, t.name AS theater_name, s.hall_id, h.name AS hall_name,
              s.movie_id, m.title AS movie_title,
              COALESCE(SUM(b.seat_count), 0) AS tickets
       FROM showtimes AS s
       JOIN theaters AS t ON t.id = s.theater_id
       JOIN halls AS h ON h.id = s.hall_id
       JOIN movies AS m ON m.id = s.movie_id
       LEFT JOIN bookings AS b ON b.showtime_id = s.id AND b.status = 'confirmed'
       WHERE s.cinema_date = ? AND s.status = 'scheduled' AND s.starts_at > ?
       GROUP BY s.id, t.name, h.name, m.title
       HAVING COALESCE(SUM(b.seat_count), 0) * 100 < ? * s.seat_capacity
       ORDER BY s.starts_at, s.id`,
      [cinemaDate, now, thresholdPercent],
    );
    return result.rows;
  }

  /**
   * Every active hall of an active theater, on each of `dates`, that has no scheduled showtime
   * that cinema date (`idx_showtimes_theater_id_cinema_date_starts_at`), by date, theater and
   * hall name. Whether the theater is open that day is decided by the service.
   */
  async hallGaps(dates: readonly CalendarDate[]): Promise<HallGapRow[]> {
    const result = await this.db.executor().raw<{ rows: HallGapRow[] }>(
      `SELECT h.id AS hall_id, h.name AS hall_name, t.id AS theater_id, t.name AS theater_name,
              d.cinema_date
       FROM halls AS h
       JOIN theaters AS t ON t.id = h.theater_id
       CROSS JOIN unnest(?::date[]) AS d (cinema_date)
       WHERE h.status = 'active' AND t.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM showtimes AS s
           WHERE s.theater_id = h.theater_id AND s.hall_id = h.id
             AND s.cinema_date = d.cinema_date AND s.status = 'scheduled')
       ORDER BY d.cinema_date, t.name, h.name, h.id`,
      [[...dates]],
    );
    return result.rows;
  }

  /** Which of `keys` this staff member has seen, and when first (`pk_staff_alert_reads`). */
  async readsOf(staffUserId: number, keys: readonly string[]): Promise<AlertReadRow[]> {
    if (keys.length === 0) return [];
    return this.db
      .executor()('staff_alert_reads')
      .select<AlertReadRow[]>('alert_key', 'seen_at')
      .where('staff_user_id', staffUserId)
      .whereIn('alert_key', [...keys]);
  }

  /**
   * Records `keys` as seen at `seenAt`; a key seen before keeps its first `seen_at`. Returns how
   * many keys were new.
   */
  async markSeen(staffUserId: number, keys: readonly string[], seenAt: Date): Promise<number> {
    if (keys.length === 0) return 0;
    const inserted = await this.db
      .executor()('staff_alert_reads')
      .insert(keys.map((key) => ({ staff_user_id: staffUserId, alert_key: key, seen_at: seenAt })))
      .onConflict(['staff_user_id', 'alert_key'])
      .ignore()
      .returning<{ alert_key: string }[]>('alert_key');
    return inserted.length;
  }

  /** Deletes this staff member's reads seen before `before` (tidying, never correctness). */
  async deleteSeenBefore(staffUserId: number, before: Date): Promise<number> {
    return this.db
      .executor()('staff_alert_reads')
      .where('staff_user_id', staffUserId)
      .where('seen_at', '<', before)
      .delete();
  }
}
