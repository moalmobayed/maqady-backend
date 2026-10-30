import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { addDays, cinemaDateOf, cinemaDayBounds } from '../../common/time/time';
import type { CalendarDate } from '../../common/time/types';
import { SettlementService } from '../bookings/settlement.service';
import {
  OVERVIEW_PERIOD_DAYS,
  REVENUE_TREND_DAYS,
  TONIGHT_LIMIT,
  TOP_MOVIES_LIMIT,
} from './analytics.constants';
import {
  comparisonDatesOf,
  datesBetween,
  figuresOf,
  hallRevenueOf,
  heatmapOf,
  kpisOf,
  namedIdsOf,
  paymentMethodsOf,
  revenueTrendOf,
  theaterRevenueOf,
  tonightShowtimeOf,
  topMoviesOf,
} from './overview';
import { OverviewRepository } from './overview.repository';
import { PaymentsReportService } from './payments-report.service';
import type {
  ComparisonPeriod,
  NamedRow,
  Overview,
  OverviewPeriod,
  OverviewQuery,
  PeriodRows,
  TheaterRef,
} from './types';

/**
 * The admin Overview (PRD A1; design §11, §13.3), admins only: the KPI cards with their
 * comparisons, revenue by theater (and by hall for one theater), payment methods, top movies, the
 * busy-times heatmap, "Revenue · last 30 days" and "Tonight", for a period of cinema days and all
 * theaters or one. Computed on read with SQL aggregates after a batched settlement, never from
 * rollups; the "Needs attention" list is the bell's (`AlertsService`).
 *
 * Exported for the overview CSV (U19), which exports the same view.
 */
@Injectable()
export class OverviewService {
  constructor(
    private readonly overview: OverviewRepository,
    private readonly payments: PaymentsReportService,
    private readonly settlement: SettlementService,
    private readonly clock: Clock,
  ) {}

  /**
   * The period a query asks for: a preset (`today`, `7d`, `30d`: that many cinema days ending
   * today) or `dateFrom` / `dateTo` with the Payments screen's rules (`periodOf()`: both
   * inclusive, the last 7 cinema days by default, at most 366). A preset with dates is
   * `VALIDATION_FAILED`.
   */
  periodOf(query: Pick<OverviewQuery, 'period' | 'dateFrom' | 'dateTo'>): OverviewPeriod {
    if (
      query.period !== undefined &&
      (query.dateFrom !== undefined || query.dateTo !== undefined)
    ) {
      throw invalid('period', 'period cannot be combined with dateFrom or dateTo');
    }
    let dates: Pick<OverviewQuery, 'dateFrom' | 'dateTo'> = query;
    if (query.period !== undefined) {
      const today = cinemaDateOf(this.clock.now());
      dates = { dateFrom: addDays(today, 1 - OVERVIEW_PERIOD_DAYS[query.period]), dateTo: today };
    }
    const period = this.payments.periodOf(dates);
    return {
      ...period,
      preset: query.period ?? null,
      days: datesBetween(period.dateFrom, period.dateTo).length,
    };
  }

  /**
   * `GET /admin/overview`. An unknown `theaterId` is `NOT_FOUND`. Due slow payments are settled
   * first in their own transaction, so a sale whose result is due counts (or not) as it ends.
   * Seven reads, one after the other, whatever the period's size: no query per row.
   */
  async read(query: OverviewQuery): Promise<Overview> {
    const period = this.periodOf(query);
    const comparison = comparisonOf(period);
    // One after the other: inside a transaction they would share one connection.
    const theater = query.theaterId === undefined ? null : await this.theater(query.theaterId);
    await this.settlement.settleAllDue();
    const now = this.clock.now();
    const cinemaDate = cinemaDateOf(now);
    const theaterId = query.theaterId;
    const current = await this.periodRows(period.dateFrom, period.dateTo, theaterId);
    const previous = await this.periodRows(comparison.dateFrom, comparison.dateTo, theaterId);
    const trendDates = datesBetween(addDays(period.dateTo, 1 - REVENUE_TREND_DAYS), period.dateTo);
    const daily = await this.overview.dailyRevenue(
      trendDates[0]!,
      trendDates[trendDates.length - 1]!,
      theaterId,
    );
    const tonight = await this.overview.tonight(cinemaDate, now, theaterId, TONIGHT_LIMIT);

    const ids = namedIdsOf([...current.showtimes, ...previous.showtimes]);
    const theaterIds = [...ids.theaterIds, ...daily.map((row) => row.theater_id)];
    const theaterNames = nameMap(await this.overview.theaterNames([...new Set(theaterIds)]));
    const hallNames =
      theater === null
        ? new Map<number, string>()
        : nameMap(await this.overview.hallNames(ids.hallIds));
    const movieNames = nameMap(
      await this.overview.movieTitles(namedIdsOf(current.showtimes).movieIds),
    );

    return {
      period,
      comparison,
      theater,
      cinemaDate,
      serverTime: now,
      kpis: kpisOf(figuresOf(current), figuresOf(previous)),
      byTheater: theaterRevenueOf(current, previous, theaterNames),
      byHall: theater === null ? null : hallRevenueOf(current.showtimes, hallNames),
      paymentMethods: paymentMethodsOf(current.methods),
      topMovies: topMoviesOf(current.showtimes, movieNames, TOP_MOVIES_LIMIT),
      heatmap: heatmapOf(current.showtimes),
      revenueTrend: revenueTrendOf(daily, trendDates, theaterNames, theaterId),
      tonight: {
        cinemaDate,
        items: tonight.map((row) => tonightShowtimeOf(row, now)),
        total: tonight[0]?.total_count ?? 0,
      },
    };
  }

  private async theater(id: number): Promise<TheaterRef> {
    const row = await this.overview.findTheater(id);
    if (row === undefined) throw new AppError('NOT_FOUND');
    return { id: row.id, name: row.name };
  }

  private async periodRows(
    dateFrom: CalendarDate,
    dateTo: CalendarDate,
    theaterId: number | undefined,
  ): Promise<PeriodRows> {
    const showtimes = await this.overview.showtimeAggregates(dateFrom, dateTo, theaterId);
    const methods = await this.overview.methodSplit(dateFrom, dateTo, theaterId);
    return { showtimes, methods };
  }
}

/** The comparison period of a period (PRD "Comparisons"), with its instants. */
function comparisonOf(period: OverviewPeriod): ComparisonPeriod {
  const dates = comparisonDatesOf(period.dateFrom, period.dateTo, period.days);
  return {
    ...dates,
    days: period.days,
    from: cinemaDayBounds(dates.dateFrom).startsAt,
    to: cinemaDayBounds(dates.dateTo).endsAt,
  };
}

function nameMap(rows: readonly NamedRow[]): ReadonlyMap<number, string> {
  return new Map(rows.map((row) => [row.id, row.name]));
}

function invalid(field: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', undefined, {
    fields: [{ field, messages: [message] }],
  });
}
