import type { MoneyResponse } from '../../common/money/dto/money-response.dto';
import type {
  AdminOverviewResponse,
  SalesFiguresResponse,
} from '../analytics/dto/admin-overview.response';
import { decimalOf } from './csv';
import type { OverviewFigureInput, OverviewFigureRow, OverviewSection } from './types';

/**
 * The Overview as its CSV (PRD A1 "Export CSV of the current view"): one row per figure of every
 * card, table and chart of `GET /admin/overview`, in the screen's order. Money is in pounds;
 * ratios are as the API answers them (0.4567 = 45.67%).
 */
export function overviewRows(overview: AdminOverviewResponse): OverviewFigureRow[] {
  const rows: OverviewFigureRow[] = [];
  const add = (input: OverviewFigureInput): void => {
    rows.push({
      section: input.section,
      cinemaDate: input.cinemaDate ?? null,
      subjectId: input.subjectId ?? null,
      subject: input.subject ?? null,
      metric: input.metric,
      unit: input.unit,
      value: input.value,
      previous: input.previous ?? null,
      change: input.change ?? null,
    });
  };

  const { period, comparison, theater, kpis } = overview;
  const scope = { subjectId: theater?.id ?? null, subject: theater?.name ?? 'All theaters' };
  add({ section: 'period', ...scope, metric: 'preset', unit: 'text', value: period.preset });
  add({ section: 'period', ...scope, metric: 'dateFrom', unit: 'date', value: period.dateFrom });
  add({ section: 'period', ...scope, metric: 'dateTo', unit: 'date', value: period.dateTo });
  add({ section: 'period', ...scope, metric: 'days', unit: 'count', value: period.days });
  add({ section: 'period', ...scope, metric: 'comparison', unit: 'text', value: comparison.basis });
  add({
    section: 'period',
    ...scope,
    metric: 'comparisonDateFrom',
    unit: 'date',
    value: comparison.dateFrom,
  });
  add({
    section: 'period',
    ...scope,
    metric: 'comparisonDateTo',
    unit: 'date',
    value: comparison.dateTo,
  });
  add({
    section: 'period',
    ...scope,
    metric: 'generatedAt',
    unit: 'text',
    value: overview.serverTime,
  });

  add({
    section: 'kpis',
    ...scope,
    metric: 'revenue',
    unit: 'EGP',
    value: pounds(kpis.revenue.value),
    previous: pounds(kpis.revenue.previous),
    change: kpis.revenue.change,
  });
  add({
    section: 'kpis',
    ...scope,
    metric: 'ticketsSold',
    unit: 'count',
    value: kpis.ticketsSold.value,
    previous: kpis.ticketsSold.previous,
    change: kpis.ticketsSold.change,
  });
  add({
    section: 'kpis',
    ...scope,
    metric: 'occupancy',
    unit: 'ratio',
    value: kpis.occupancy.value,
    previous: kpis.occupancy.previous,
    change: kpis.occupancy.change,
  });
  add({
    section: 'kpis',
    ...scope,
    metric: 'averageTicket',
    unit: 'EGP',
    value: pounds(kpis.averageTicket.value),
    previous: pounds(kpis.averageTicket.previous),
    change: kpis.averageTicket.change,
  });
  add({
    section: 'kpis',
    ...scope,
    metric: 'counterShare',
    unit: 'ratio',
    value: kpis.counterShare.value,
    previous: kpis.counterShare.previous,
    change: kpis.counterShare.change,
  });

  for (const row of overview.byTheater) {
    const subject = { subjectId: row.theater.id, subject: row.theater.name };
    add({
      section: 'by_theater',
      ...subject,
      metric: 'revenue',
      unit: 'EGP',
      value: pounds(row.revenue),
      previous: pounds(row.previousRevenue),
      change: row.change,
    });
    add({
      section: 'by_theater',
      ...subject,
      metric: 'online',
      unit: 'EGP',
      value: pounds(row.online),
    });
    add({
      section: 'by_theater',
      ...subject,
      metric: 'counter',
      unit: 'EGP',
      value: pounds(row.counter),
    });
    add({
      section: 'by_theater',
      ...subject,
      metric: 'averageTicket',
      unit: 'EGP',
      value: pounds(row.averageTicket),
    });
    salesRows('by_theater', subject, row).forEach(add);
  }
  for (const row of overview.byHall ?? []) {
    const subject = { subjectId: row.hall.id, subject: row.hall.name };
    add({
      section: 'by_hall',
      ...subject,
      metric: 'revenue',
      unit: 'EGP',
      value: pounds(row.revenue),
    });
    salesRows('by_hall', subject, row).forEach(add);
  }
  for (const row of overview.paymentMethods) {
    const subject = { subject: row.method };
    add({
      section: 'payment_methods',
      ...subject,
      metric: 'amount',
      unit: 'EGP',
      value: pounds(row.amount),
    });
    add({
      section: 'payment_methods',
      ...subject,
      metric: 'share',
      unit: 'ratio',
      value: row.share,
    });
  }
  for (const row of overview.topMovies) {
    const subject = { subjectId: row.movie.id, subject: row.movie.name };
    add({
      section: 'top_movies',
      ...subject,
      metric: 'revenue',
      unit: 'EGP',
      value: pounds(row.revenue),
    });
    salesRows('top_movies', subject, row).forEach(add);
  }
  for (const cell of overview.heatmap) {
    const subject = { subjectId: cell.weekday, subject: cell.slot };
    add({
      section: 'heatmap',
      ...subject,
      metric: 'showtimeCount',
      unit: 'count',
      value: cell.showtimeCount,
    });
    add({
      section: 'heatmap',
      ...subject,
      metric: 'ticketsSold',
      unit: 'count',
      value: cell.ticketsSold,
    });
    add({
      section: 'heatmap',
      ...subject,
      metric: 'seatsOnSale',
      unit: 'count',
      value: cell.seatsOnSale,
    });
    add({
      section: 'heatmap',
      ...subject,
      metric: 'occupancy',
      unit: 'ratio',
      value: cell.occupancy,
    });
  }
  for (const point of overview.revenueTrend.totals) {
    add({
      section: 'revenue_trend',
      cinemaDate: point.cinemaDate,
      subject: 'All theaters',
      metric: 'revenue',
      unit: 'EGP',
      value: pounds(point.revenue),
    });
  }
  for (const series of overview.revenueTrend.theaters) {
    for (const point of series.points) {
      add({
        section: 'revenue_trend',
        cinemaDate: point.cinemaDate,
        subjectId: series.theater.id,
        subject: series.theater.name,
        metric: 'revenue',
        unit: 'EGP',
        value: pounds(point.revenue),
      });
    }
  }
  for (const show of overview.tonight.items) {
    const subject = {
      cinemaDate: show.cinemaDate,
      subjectId: show.showtimeId,
      subject: show.movie.name,
    };
    add({ section: 'tonight', ...subject, metric: 'startsAt', unit: 'text', value: show.startsAt });
    add({
      section: 'tonight',
      ...subject,
      metric: 'theater',
      unit: 'text',
      value: show.theater.name,
    });
    add({ section: 'tonight', ...subject, metric: 'hall', unit: 'text', value: show.hall.name });
    add({
      section: 'tonight',
      ...subject,
      metric: 'ticketsSold',
      unit: 'count',
      value: show.ticketsSold,
    });
    add({
      section: 'tonight',
      ...subject,
      metric: 'seatCapacity',
      unit: 'count',
      value: show.seatCapacity,
    });
    add({
      section: 'tonight',
      ...subject,
      metric: 'soldShare',
      unit: 'ratio',
      value: show.soldShare,
    });
    add({
      section: 'tonight',
      ...subject,
      metric: 'revenue',
      unit: 'EGP',
      value: pounds(show.revenue),
    });
  }
  return rows;
}

/** Tickets, seats on sale, occupancy and showtimes of a theater, hall or movie. */
function salesRows(
  section: OverviewSection,
  subject: { readonly subjectId: number; readonly subject: string },
  row: SalesFiguresResponse,
): OverviewFigureInput[] {
  return [
    { section, ...subject, metric: 'ticketsSold', unit: 'count', value: row.ticketsSold },
    { section, ...subject, metric: 'seatsOnSale', unit: 'count', value: row.seatsOnSale },
    { section, ...subject, metric: 'occupancy', unit: 'ratio', value: row.occupancy },
    { section, ...subject, metric: 'showtimeCount', unit: 'count', value: row.showtimeCount },
  ];
}

function pounds(value: MoneyResponse | null): number | null {
  return value === null ? null : decimalOf(value.amount);
}
