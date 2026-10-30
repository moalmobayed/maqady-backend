import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { encodeCursor, toPageRequest } from '../../common/pagination/cursor';
import type { PageQueryInput } from '../../common/pagination/types';
import { Clock } from '../../common/time/clock';
import {
  addDays,
  cinemaDateOf,
  cinemaDayBounds,
  subtractFromInstant,
} from '../../common/time/time';
import type { CalendarDate } from '../../common/time/types';
import { SettlementService } from '../bookings/settlement.service';
import { TheaterHoursService } from '../theaters/theater-hours.service';
import {
  ALERT_READ_RETENTION_HOURS,
  HALL_GAP_DAYS,
  LOW_SALES_THRESHOLD_PERCENT,
} from './analytics.constants';
import {
  failedPaymentsAlert,
  hallGapAlert,
  lowSalesAlert,
  sortAlerts,
  startAfter,
  withReadState,
} from './alerts';
import { AlertsRepository } from './alerts.repository';
import { datesBetween } from './overview';
import type { Alert, AlertPage, AlertReadResult, HallGapRow, StaffAlert } from './types';

/**
 * The bell and the Overview's "Needs attention" (PRD A1, "Notifications panel"; design §13.3),
 * for both staff roles. Alerts are computed on read from the stored facts at `Clock.now()`, each
 * with a stable key, never raised by a timer: a condition that holds shows its alert, one that no
 * longer holds is simply not listed. `staff_alert_reads` records which keys each staff member has
 * seen; the unread count is the current keys they have not.
 *
 * Exported for the overview CSV (U19) and any later screen that lists the same alerts.
 */
@Injectable()
export class AlertsService {
  constructor(
    private readonly alerts: AlertsRepository,
    private readonly hours: TheaterHoursService,
    private readonly settlement: SettlementService,
    private readonly clock: Clock,
  ) {}

  /**
   * Every alert that holds at `now`, in no particular order: failed online payments on today's
   * cinema day, showtimes later today under `LOW_SALES_THRESHOLD_PERCENT` sold, and active halls
   * of active theaters with no scheduled showtime on an open cinema day among today and the next
   * `HALL_GAP_DAYS - 1` (a day the theater is closed, or has no hours for, is no gap). Reads on
   * the current executor, so it also runs inside a request transaction.
   */
  async current(now: Date): Promise<Alert[]> {
    const cinemaDate = cinemaDateOf(now);
    const today = cinemaDayBounds(cinemaDate);
    // One after the other: inside a transaction they would share one connection.
    const failed = await this.alerts.failedOnlineChargeCount({
      from: today.startsAt,
      to: today.endsAt,
    });
    const lowSales = await this.alerts.lowSalesShowtimes(
      cinemaDate,
      now,
      LOW_SALES_THRESHOLD_PERCENT,
    );
    const gaps = await this.openDayGaps(
      datesBetween(cinemaDate, addDays(cinemaDate, HALL_GAP_DAYS - 1)),
    );
    const failedAlert = failedPaymentsAlert(cinemaDate, failed);
    return [
      ...(failedAlert === null ? [] : [failedAlert]),
      ...lowSales.map((row) => lowSalesAlert(row, cinemaDate)),
      ...gaps.map(hallGapAlert),
    ];
  }

  /**
   * `GET /admin/alerts`: the caller's current alerts, unread first, cursor-paged over the
   * computed list, with the bell's `unreadCount` and the `total`. Due slow payments are settled
   * first, so a payment whose decline is due counts today.
   */
  async page(staffUserId: number, query: PageQueryInput): Promise<AlertPage> {
    const request = toPageRequest(query, 'text');
    await this.settlement.settleAllDue();
    const now = this.clock.now();
    const sorted = sortAlerts(await this.withReads(staffUserId, await this.current(now)));
    const start =
      request.after === null
        ? 0
        : startAfter(sorted, String(request.after.sortKey), request.after.id);
    const items = sorted.slice(start, start + request.limit);
    const last = items[items.length - 1];
    const hasMore = start + request.limit < sorted.length && last !== undefined;
    return {
      items,
      nextCursor: hasMore ? encodeCursor({ sortKey: last.key, id: start + items.length }) : null,
      total: sorted.length,
      unreadCount: sorted.filter((alert) => !alert.read).length,
      cinemaDate: cinemaDateOf(now),
      serverTime: now,
    };
  }

  /**
   * `POST /admin/alert-reads`, in the request transaction: marks `keys` seen for the caller, or
   * every current key when none is given. A key that is not a current alert (it was resolved, or
   * a newer count replaced it) is ignored, so a stale panel never marks tomorrow's alert. A key
   * already seen keeps its first time. The caller's reads older than `ALERT_READ_RETENTION_HOURS`
   * are tidied away. Not settled first: settlement runs in its own transaction, before any other;
   * a decline that settles later makes a new key, unread.
   */
  async markRead(
    staffUserId: number,
    keys: readonly string[] | undefined,
  ): Promise<AlertReadResult> {
    const now = this.clock.now();
    const current = await this.current(now);
    const currentKeys = new Set(current.map((alert) => alert.key));
    const wanted = keys === undefined ? [...currentKeys] : [...new Set(keys)];
    const marked = await this.alerts.markSeen(
      staffUserId,
      wanted.filter((key) => currentKeys.has(key)),
      now,
    );
    await this.alerts.deleteSeenBefore(
      staffUserId,
      subtractFromInstant(now, { hours: ALERT_READ_RETENTION_HOURS }),
    );
    const states = await this.withReads(staffUserId, current);
    return {
      markedCount: marked,
      unreadCount: states.filter((alert) => !alert.read).length,
      total: states.length,
    };
  }

  private async withReads(staffUserId: number, alerts: readonly Alert[]): Promise<StaffAlert[]> {
    const reads = await this.alerts.readsOf(
      staffUserId,
      alerts.map((alert) => alert.key),
    );
    return withReadState(alerts, reads);
  }

  /** The hall gaps of `dates` on the days each theater is open (its special date, else its weekday). */
  private async openDayGaps(dates: readonly CalendarDate[]): Promise<HallGapRow[]> {
    const first = dates[0];
    const last = dates[dates.length - 1];
    if (first === undefined || last === undefined) {
      throw new AppError('INTERNAL', 'The hall-gap window has no dates.');
    }
    const gaps = await this.alerts.hallGaps(dates);
    if (gaps.length === 0) return [];
    const hours = await this.hours.hoursFor(
      gaps.map((gap) => gap.theater_id),
      first,
      last,
    );
    return gaps.filter((gap) =>
      (hours.get(gap.theater_id) ?? []).some(
        (day) => day.cinemaDate === gap.cinema_date && day.window !== null,
      ),
    );
  }
}
