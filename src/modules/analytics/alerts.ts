import { cairoWallClockOf } from '../../common/time/time';
import type { CalendarDate } from '../../common/time/types';
import { ALERT_KINDS } from './enums';
import { ratioOf } from './overview';
import type { Alert, AlertReadRow, HallGapRow, LowSalesRow, StaffAlert } from './types';

/**
 * The bell's alerts (U17; design §13.3 "Alerts"; PRD A1 "Needs attention"), as pure functions:
 * each condition becomes one alert with a stable key, so reading the bell twice, or two staff
 * members reading it, name the same alert the same way, and a key read once stays read.
 *
 * - `failed-payments:<cinemaDate>:<count>`: the count is in the key, so another failed payment
 *   makes a new key, unread again.
 * - `low-sales:<showtimeId>`: one per showtime, while it is later today and under the threshold.
 * - `hall-gap:<hallId>:<cinemaDate>`: one per hall and day.
 */

export function failedPaymentsKey(cinemaDate: CalendarDate, count: number): string {
  return `failed-payments:${cinemaDate}:${count}`;
}

export function lowSalesKey(showtimeId: number): string {
  return `low-sales:${showtimeId}`;
}

export function hallGapKey(hallId: number, cinemaDate: CalendarDate): string {
  return `hall-gap:${hallId}:${cinemaDate}`;
}

/** The `failed-payments` alert of today, or none when nothing failed. */
export function failedPaymentsAlert(cinemaDate: CalendarDate, count: number): Alert | null {
  if (count === 0) return null;
  return {
    key: failedPaymentsKey(cinemaDate, count),
    kind: 'failed_payments',
    cinemaDate,
    title: count === 1 ? '1 online payment failed today' : `${count} online payments failed today`,
    failedPayments: { count },
    lowSales: null,
    hallGap: null,
  };
}

/** A `low-sales` alert: "Midnight Tram 23:30 in Hall 3, Maqady Zamalek, is 28% sold". */
export function lowSalesAlert(row: LowSalesRow, cinemaDate: CalendarDate): Alert {
  const soldShare = ratioOf(row.tickets, row.seat_capacity) ?? 0;
  const percent = Math.floor((row.tickets * 100) / row.seat_capacity);
  return {
    key: lowSalesKey(row.showtime_id),
    kind: 'low_sales',
    cinemaDate,
    title: `${row.movie_title} ${cairoWallClockOf(row.starts_at)} in ${row.hall_name}, ${row.theater_name}, is ${percent}% sold`,
    failedPayments: null,
    lowSales: {
      showtimeId: row.showtime_id,
      startsAt: row.starts_at,
      movie: { id: row.movie_id, name: row.movie_title },
      theater: { id: row.theater_id, name: row.theater_name },
      hall: { id: row.hall_id, name: row.hall_name },
      ticketsSold: row.tickets,
      seatCapacity: row.seat_capacity,
      soldShare,
    },
    hallGap: null,
  };
}

/** A `hall-gap` alert: "Hall 4 at Maqady Zamalek has no showtimes on 2026-10-17". */
export function hallGapAlert(row: HallGapRow): Alert {
  return {
    key: hallGapKey(row.hall_id, row.cinema_date),
    kind: 'hall_gap',
    cinemaDate: row.cinema_date,
    title: `${row.hall_name} at ${row.theater_name} has no showtimes on ${row.cinema_date}`,
    failedPayments: null,
    lowSales: null,
    hallGap: {
      hall: { id: row.hall_id, name: row.hall_name },
      theater: { id: row.theater_id, name: row.theater_name },
    },
  };
}

/**
 * The panel's order: unread first; then failed payments, low sales (soonest show first), hall gaps
 * (soonest day first, then theater and hall by name); the key breaks any tie, so the order is total.
 */
export function sortAlerts(alerts: readonly StaffAlert[]): StaffAlert[] {
  return [...alerts].sort((first, second) => {
    if (first.read !== second.read) return first.read ? 1 : -1;
    return compareAlerts(first, second);
  });
}

/** Each alert with whether this staff member has seen its key, and when first. */
export function withReadState(
  alerts: readonly Alert[],
  reads: readonly AlertReadRow[],
): StaffAlert[] {
  const seen = new Map(reads.map((row) => [row.alert_key, row.seen_at]));
  return alerts.map((alert) => {
    const readAt = seen.get(alert.key) ?? null;
    return { ...alert, read: readAt !== null, readAt };
  });
}

/**
 * Where the next page starts in `sorted`, after the alert with `key` (the cursor's sort key) at
 * 1-based `position` (its id): right after that key if it is still listed, else at the position,
 * so a page read while alerts change neither fails nor starts over.
 */
export function startAfter(sorted: readonly StaffAlert[], key: string, position: number): number {
  const index = sorted.findIndex((alert) => alert.key === key);
  return index === -1 ? Math.min(position, sorted.length) : index + 1;
}

function compareAlerts(first: Alert, second: Alert): number {
  const byKind = ALERT_KINDS.indexOf(first.kind) - ALERT_KINDS.indexOf(second.kind);
  if (byKind !== 0) return byKind;
  if (first.lowSales !== null && second.lowSales !== null) {
    const byStart = first.lowSales.startsAt.getTime() - second.lowSales.startsAt.getTime();
    if (byStart !== 0) return byStart;
  }
  if (first.hallGap !== null && second.hallGap !== null) {
    if (first.cinemaDate !== second.cinemaDate)
      return first.cinemaDate < second.cinemaDate ? -1 : 1;
    const byTheater = first.hallGap.theater.name.localeCompare(second.hallGap.theater.name, 'en');
    if (byTheater !== 0) return byTheater;
    const byHall = first.hallGap.hall.name.localeCompare(second.hallGap.hall.name, 'en');
    if (byHall !== 0) return byHall;
  }
  return first.key < second.key ? -1 : first.key > second.key ? 1 : 0;
}
