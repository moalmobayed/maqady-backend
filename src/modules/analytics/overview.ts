import { money } from '../../common/money/money';
import type { Money } from '../../common/money/types';
import { addDays, cairoWallClockOf, weekdayOfCinemaDate } from '../../common/time/time';
import type { CalendarDate, IsoWeekday } from '../../common/time/types';
import { PAYMENT_METHODS } from '../payments/enums';
import { RATIO_DECIMALS, SAME_WEEKDAY_OFFSET_DAYS } from './analytics.constants';
import { SHOWTIME_SLOTS } from './enums';
import { channelOfMethod } from './transaction-status.sql';
import type {
  ComparisonDates,
  DailyRevenueRow,
  HallRevenue,
  HeatmapCell,
  KpiCard,
  MethodRevenue,
  MethodSplitRow,
  MovieRevenue,
  NamedIds,
  NamedRef,
  OverviewFigures,
  OverviewKpis,
  PeriodRows,
  RevenueTrend,
  SalesFigures,
  ShowtimeAggregateRow,
  ShowtimeSlot,
  TheaterRef,
  TheaterRevenue,
  TonightRow,
  TonightShowtime,
} from './types';

/**
 * Pure folds of the Overview (U17; PRD A1, "Dashboard numbers"; design §13.3). The repository
 * reads one row per showtime of a period (its Confirmed and Completed bookings' totals and seats)
 * and the money of those bookings by theater and method; every card, table, chart and the heatmap
 * is folded here from those same rows, so they always agree with each other.
 *
 * - Revenue and tickets count every Confirmed and Completed booking on its showtime's cinema day.
 * - Occupancy counts scheduled showtimes only (PRD "Cancelled showtimes are left out"): their
 *   tickets ÷ their `seat_capacity` (seats on sale: gaps are not seats, wheelchair spaces are).
 * - Counter share is the money taken at the box office (cash, card terminal) ÷ all the money of
 *   those bookings, from the payments ledger.
 */

const RATIO_SCALE = 10 ** RATIO_DECIMALS;

/** `numerator ÷ denominator` rounded to `RATIO_DECIMALS`; null when the denominator is 0. */
export function ratioOf(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * RATIO_SCALE) / RATIO_SCALE;
}

/** `(value − previous) ÷ previous`, rounded; null when either is null or `previous` is 0. */
export function relativeChange(value: number | null, previous: number | null): number | null {
  if (value === null || previous === null || previous === 0) return null;
  return ratioOf(value - previous, previous);
}

/** Every cinema date from `from` to `to`, both included, in order. */
export function datesBetween(from: CalendarDate, to: CalendarDate): CalendarDate[] {
  const dates: CalendarDate[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

/**
 * What a period is compared with (PRD "Comparisons"): a single day against the same weekday last
 * week; a longer period against the same number of days just before it.
 */
export function comparisonDatesOf(
  dateFrom: CalendarDate,
  dateTo: CalendarDate,
  days: number,
): ComparisonDates {
  if (days === 1) {
    return {
      dateFrom: addDays(dateFrom, -SAME_WEEKDAY_OFFSET_DAYS),
      dateTo: addDays(dateTo, -SAME_WEEKDAY_OFFSET_DAYS),
      basis: 'same_weekday_last_week',
    };
  }
  return {
    dateFrom: addDays(dateFrom, -days),
    dateTo: addDays(dateFrom, -1),
    basis: 'previous_period',
  };
}

/**
 * The heatmap column of a showtime, by its Cairo start time (design §13.3): 06:00–14:59
 * `before_15`, 15:00–17:59, 18:00–20:59, 21:00–23:59, and 00:00–05:59 `after_midnight` (still the
 * previous cinema day).
 */
export function slotOf(startsAt: Date): ShowtimeSlot {
  const hour = Number(cairoWallClockOf(startsAt).slice(0, 2));
  if (hour < 6) return 'after_midnight';
  if (hour < 15) return 'before_15';
  if (hour < 18) return '15_18';
  if (hour < 21) return '18_21';
  return '21_24';
}

/** The five KPI figures of one period's rows. */
export function figuresOf(rows: PeriodRows): OverviewFigures {
  const sales = salesOf(rows.showtimes);
  const ticketsSold = sum(rows.showtimes, (row) => row.tickets);
  const revenue = sum(rows.showtimes, (row) => row.revenue);
  const counter = sum(
    rows.methods.filter((row) => channelOfMethod(row.method) === 'counter'),
    (row) => row.amount,
  );
  const allMethods = sum(rows.methods, (row) => row.amount);
  return {
    revenue: money(revenue),
    ticketsSold,
    seatsOnSale: sales.seatsOnSale,
    occupancy: sales.occupancy,
    averageTicket: averageTicketOf(revenue, ticketsSold),
    counterShare: ratioOf(counter, allMethods),
  };
}

/** The KPI cards: each figure of the period beside the comparison's, with the change. */
export function kpisOf(current: OverviewFigures, previous: OverviewFigures): OverviewKpis {
  return {
    revenue: cardOf(current.revenue, previous.revenue, (value) => value.amount),
    ticketsSold: cardOf(current.ticketsSold, previous.ticketsSold, (value) => value),
    occupancy: cardOf(current.occupancy, previous.occupancy, (value) => value),
    averageTicket: cardOf(
      current.averageTicket,
      previous.averageTicket,
      (value) => value?.amount ?? null,
    ),
    counterShare: cardOf(current.counterShare, previous.counterShare, (value) => value),
  };
}

/**
 * "Revenue by theater" (PRD A1): every theater with a showtime in the period or revenue in the
 * comparison, highest revenue first (then name, then id), with its Online / Counter split from
 * the ledger and its revenue against the comparison's.
 */
export function theaterRevenueOf(
  current: PeriodRows,
  previous: PeriodRows,
  theaters: ReadonlyMap<number, string>,
): TheaterRevenue[] {
  const ids = new Set<number>([
    ...current.showtimes.map((row) => row.theater_id),
    ...previous.showtimes.filter((row) => row.revenue > 0).map((row) => row.theater_id),
  ]);
  const rows = [...ids].map((id): TheaterRevenue => {
    const own = current.showtimes.filter((row) => row.theater_id === id);
    const methods = current.methods.filter((row) => row.theater_id === id);
    const sales = salesOf(own);
    const revenue = sum(own, (row) => row.revenue);
    const tickets = sum(own, (row) => row.tickets);
    const previousRevenue = sum(
      previous.showtimes.filter((row) => row.theater_id === id),
      (row) => row.revenue,
    );
    return {
      theater: refOf(id, theaters),
      ...sales,
      averageTicket: averageTicketOf(revenue, tickets),
      online: money(
        sum(
          methods.filter((row) => channelOfMethod(row.method) === 'online'),
          (row) => row.amount,
        ),
      ),
      counter: money(
        sum(
          methods.filter((row) => channelOfMethod(row.method) === 'counter'),
          (row) => row.amount,
        ),
      ),
      previousRevenue: money(previousRevenue),
      change: relativeChange(revenue, previousRevenue),
    };
  });
  return rows.sort(byRevenueThenName((row) => row.theater));
}

/** "Revenue by hall" (PRD A1): each hall with a showtime in the period, highest revenue first. */
export function hallRevenueOf(
  rows: readonly ShowtimeAggregateRow[],
  halls: ReadonlyMap<number, string>,
): HallRevenue[] {
  return groupBy(rows, (row) => row.hall_id)
    .map(([id, own]) => ({ hall: refOf(id, halls), ...salesOf(own) }))
    .sort(byRevenueThenName((row) => row.hall));
}

/** "Top movies by revenue" (PRD A1): the `limit` movies with the most revenue in the period. */
export function topMoviesOf(
  rows: readonly ShowtimeAggregateRow[],
  movies: ReadonlyMap<number, string>,
  limit: number,
): MovieRevenue[] {
  return groupBy(rows, (row) => row.movie_id)
    .map(([id, own]) => ({ movie: refOf(id, movies), ...salesOf(own) }))
    .sort((first, second) => {
      if (first.revenue.amount !== second.revenue.amount) {
        return second.revenue.amount - first.revenue.amount;
      }
      if (first.ticketsSold !== second.ticketsSold) return second.ticketsSold - first.ticketsSold;
      return compareRefs(first.movie, second.movie);
    })
    .slice(0, limit);
}

/**
 * "Payment methods" (PRD A1): the money of the period's bookings by method, every method listed
 * (card, wallet, cash, card terminal), with its share of the whole.
 */
export function paymentMethodsOf(rows: readonly MethodSplitRow[]): MethodRevenue[] {
  const total = sum(rows, (row) => row.amount);
  return PAYMENT_METHODS.map((method) => {
    const amount = sum(
      rows.filter((row) => row.method === method),
      (row) => row.amount,
    );
    return { method, amount: money(amount), share: ratioOf(amount, total) };
  });
}

/**
 * The busy-times heatmap (PRD A1; design §13.3): seats sold ÷ seats on sale of the scheduled
 * showtimes, by the cinema date's weekday (1 Monday … 7 Sunday) and start-time slot. All 35 cells,
 * Monday first, slots in `SHOWTIME_SLOTS` order; an empty cell has a null occupancy.
 */
export function heatmapOf(rows: readonly ShowtimeAggregateRow[]): HeatmapCell[] {
  const scheduled = rows.filter((row) => row.status === 'scheduled');
  const cells: HeatmapCell[] = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    for (const slot of SHOWTIME_SLOTS) {
      const own = scheduled.filter(
        (row) => weekdayOfCinemaDate(row.cinema_date) === weekday && slotOf(row.starts_at) === slot,
      );
      const ticketsSold = sum(own, (row) => row.tickets);
      const seatsOnSale = sum(own, (row) => row.seat_capacity);
      cells.push({
        weekday: weekday as IsoWeekday,
        slot,
        showtimeCount: own.length,
        ticketsSold,
        seatsOnSale,
        occupancy: ratioOf(ticketsSold, seatsOnSale),
      });
    }
  }
  return cells;
}

/**
 * "Revenue · last 30 days" (PRD A1): every cinema date of the window with its revenue (0 when
 * none), for all theaters and for each theater with revenue in the window (plus the selected one),
 * theaters by name.
 */
export function revenueTrendOf(
  rows: readonly DailyRevenueRow[],
  dates: readonly CalendarDate[],
  theaters: ReadonlyMap<number, string>,
  selectedTheaterId: number | undefined,
): RevenueTrend {
  const ids = new Set(rows.filter((row) => row.revenue > 0).map((row) => row.theater_id));
  if (selectedTheaterId !== undefined) ids.add(selectedTheaterId);
  const pointsOf = (own: readonly DailyRevenueRow[]) =>
    dates.map((cinemaDate) => ({
      cinemaDate,
      revenue: money(
        sum(
          own.filter((row) => row.cinema_date === cinemaDate),
          (row) => row.revenue,
        ),
      ),
    }));
  return {
    dateFrom: dates[0]!,
    dateTo: dates[dates.length - 1]!,
    totals: pointsOf(rows),
    theaters: [...ids]
      .map((id) => ({
        theater: refOf(id, theaters),
        points: pointsOf(rows.filter((row) => row.theater_id === id)),
      }))
      .sort((first, second) => compareRefs(first.theater, second.theater)),
  };
}

/** A row of the "Tonight" list, with `hasStarted` decided at `now`. */
export function tonightShowtimeOf(row: TonightRow, now: Date): TonightShowtime {
  return {
    showtimeId: row.showtime_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    cinemaDate: row.cinema_date,
    hasStarted: row.starts_at.getTime() <= now.getTime(),
    movie: { id: row.movie_id, name: row.movie_title },
    theater: { id: row.theater_id, name: row.theater_name },
    hall: { id: row.hall_id, name: row.hall_name },
    ticketsSold: row.tickets,
    seatCapacity: row.seat_capacity,
    soldShare: ratioOf(row.tickets, row.seat_capacity) ?? 0,
    revenue: money(row.revenue),
  };
}

/** The ids of every theater, hall and movie the folds name. */
export function namedIdsOf(rows: readonly ShowtimeAggregateRow[]): NamedIds {
  return {
    theaterIds: [...new Set(rows.map((row) => row.theater_id))],
    hallIds: [...new Set(rows.map((row) => row.hall_id))],
    movieIds: [...new Set(rows.map((row) => row.movie_id))],
  };
}

function salesOf(rows: readonly ShowtimeAggregateRow[]): SalesFigures {
  const scheduled = rows.filter((row) => row.status === 'scheduled');
  const scheduledTickets = sum(scheduled, (row) => row.tickets);
  const seatsOnSale = sum(scheduled, (row) => row.seat_capacity);
  return {
    revenue: money(sum(rows, (row) => row.revenue)),
    ticketsSold: sum(rows, (row) => row.tickets),
    seatsOnSale,
    occupancy: ratioOf(scheduledTickets, seatsOnSale),
    showtimeCount: scheduled.length,
  };
}

function averageTicketOf(revenue: number, tickets: number): Money | null {
  return tickets === 0 ? null : money(Math.round(revenue / tickets));
}

function cardOf<T>(value: T, previous: T, numberOf: (value: T) => number | null): KpiCard<T> {
  return { value, previous, change: relativeChange(numberOf(value), numberOf(previous)) };
}

function refOf(id: number, names: ReadonlyMap<number, string>): NamedRef {
  return { id, name: names.get(id) ?? '' };
}

function compareRefs(first: TheaterRef, second: TheaterRef): number {
  const byName = first.name.localeCompare(second.name, 'en');
  return byName !== 0 ? byName : first.id - second.id;
}

function byRevenueThenName<Row extends { revenue: Money }>(
  refOfRow: (row: Row) => TheaterRef,
): (first: Row, second: Row) => number {
  return (first, second) =>
    first.revenue.amount !== second.revenue.amount
      ? second.revenue.amount - first.revenue.amount
      : compareRefs(refOfRow(first), refOfRow(second));
}

function groupBy<Row>(rows: readonly Row[], keyOf: (row: Row) => number): [number, Row[]][] {
  const groups = new Map<number, Row[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return [...groups];
}

function sum<Row>(rows: readonly Row[], valueOf: (row: Row) => number): number {
  return rows.reduce((total, row) => total + valueOf(row), 0);
}
