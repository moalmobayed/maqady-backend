import { Injectable } from '@nestjs/common';
import { MoneyResponse } from '../../common/money/dto/money-response.dto';
import type { Money } from '../../common/money/types';
import { formatCairoIso } from '../../common/time/time';
import { NamedRefResponse } from '../bookings/dto/booking-showtime.response';
import {
  AdminOverviewResponse,
  CountKpiResponse,
  HallRevenueResponse,
  HeatmapCellResponse,
  MethodRevenueResponse,
  MoneyKpiResponse,
  MovieRevenueResponse,
  OptionalMoneyKpiResponse,
  OverviewComparisonResponse,
  OverviewKpisResponse,
  OverviewPeriodResponse,
  RatioKpiResponse,
  RevenuePointResponse,
  RevenueTrendResponse,
  TheaterRevenueResponse,
  TheaterRevenueSeriesResponse,
  TonightListResponse,
  TonightShowtimeResponse,
} from './dto/admin-overview.response';
import type {
  NamedRef,
  Overview,
  OverviewKpis,
  RevenuePoint,
  SalesFigures,
  TonightShowtime,
} from './types';

/** Response DTOs of the Overview (U17): times in Cairo ISO, money `{ amount, currency }`. */
@Injectable()
export class OverviewResponseMapper {
  overview(overview: Overview): AdminOverviewResponse {
    return Object.assign(new AdminOverviewResponse(), {
      period: Object.assign(new OverviewPeriodResponse(), {
        preset: overview.period.preset,
        dateFrom: overview.period.dateFrom,
        dateTo: overview.period.dateTo,
        days: overview.period.days,
        from: formatCairoIso(overview.period.from),
        to: formatCairoIso(overview.period.to),
      }),
      comparison: Object.assign(new OverviewComparisonResponse(), {
        basis: overview.comparison.basis,
        dateFrom: overview.comparison.dateFrom,
        dateTo: overview.comparison.dateTo,
        days: overview.comparison.days,
        from: formatCairoIso(overview.comparison.from),
        to: formatCairoIso(overview.comparison.to),
      }),
      theater: overview.theater === null ? null : toNamedRef(overview.theater),
      cinemaDate: overview.cinemaDate,
      serverTime: formatCairoIso(overview.serverTime),
      kpis: toKpis(overview.kpis),
      byTheater: overview.byTheater.map((row) =>
        Object.assign(new TheaterRevenueResponse(), {
          theater: toNamedRef(row.theater),
          ...salesOf(row),
          averageTicket: row.averageTicket === null ? null : toMoney(row.averageTicket),
          online: toMoney(row.online),
          counter: toMoney(row.counter),
          previousRevenue: toMoney(row.previousRevenue),
          change: row.change,
        }),
      ),
      byHall:
        overview.byHall === null
          ? null
          : overview.byHall.map((row) =>
              Object.assign(new HallRevenueResponse(), {
                hall: toNamedRef(row.hall),
                ...salesOf(row),
              }),
            ),
      paymentMethods: overview.paymentMethods.map((row) =>
        Object.assign(new MethodRevenueResponse(), {
          method: row.method,
          amount: toMoney(row.amount),
          share: row.share,
        }),
      ),
      topMovies: overview.topMovies.map((row) =>
        Object.assign(new MovieRevenueResponse(), {
          movie: toNamedRef(row.movie),
          ...salesOf(row),
        }),
      ),
      heatmap: overview.heatmap.map((cell) =>
        Object.assign(new HeatmapCellResponse(), {
          weekday: cell.weekday,
          slot: cell.slot,
          showtimeCount: cell.showtimeCount,
          ticketsSold: cell.ticketsSold,
          seatsOnSale: cell.seatsOnSale,
          occupancy: cell.occupancy,
        }),
      ),
      revenueTrend: Object.assign(new RevenueTrendResponse(), {
        dateFrom: overview.revenueTrend.dateFrom,
        dateTo: overview.revenueTrend.dateTo,
        totals: overview.revenueTrend.totals.map(toPoint),
        theaters: overview.revenueTrend.theaters.map((series) =>
          Object.assign(new TheaterRevenueSeriesResponse(), {
            theater: toNamedRef(series.theater),
            points: series.points.map(toPoint),
          }),
        ),
      }),
      tonight: Object.assign(new TonightListResponse(), {
        cinemaDate: overview.tonight.cinemaDate,
        items: overview.tonight.items.map(toTonight),
        total: overview.tonight.total,
      }),
    });
  }
}

function toKpis(kpis: OverviewKpis): OverviewKpisResponse {
  return Object.assign(new OverviewKpisResponse(), {
    revenue: Object.assign(new MoneyKpiResponse(), {
      value: toMoney(kpis.revenue.value),
      previous: toMoney(kpis.revenue.previous),
      change: kpis.revenue.change,
    }),
    ticketsSold: Object.assign(new CountKpiResponse(), { ...kpis.ticketsSold }),
    occupancy: Object.assign(new RatioKpiResponse(), { ...kpis.occupancy }),
    averageTicket: Object.assign(new OptionalMoneyKpiResponse(), {
      value: kpis.averageTicket.value === null ? null : toMoney(kpis.averageTicket.value),
      previous: kpis.averageTicket.previous === null ? null : toMoney(kpis.averageTicket.previous),
      change: kpis.averageTicket.change,
    }),
    counterShare: Object.assign(new RatioKpiResponse(), { ...kpis.counterShare }),
  });
}

function salesOf(row: SalesFigures) {
  return {
    revenue: toMoney(row.revenue),
    ticketsSold: row.ticketsSold,
    seatsOnSale: row.seatsOnSale,
    occupancy: row.occupancy,
    showtimeCount: row.showtimeCount,
  };
}

function toTonight(row: TonightShowtime): TonightShowtimeResponse {
  return Object.assign(new TonightShowtimeResponse(), {
    showtimeId: row.showtimeId,
    startsAt: formatCairoIso(row.startsAt),
    endsAt: formatCairoIso(row.endsAt),
    cinemaDate: row.cinemaDate,
    hasStarted: row.hasStarted,
    movie: toNamedRef(row.movie),
    theater: toNamedRef(row.theater),
    hall: toNamedRef(row.hall),
    ticketsSold: row.ticketsSold,
    seatCapacity: row.seatCapacity,
    soldShare: row.soldShare,
    revenue: toMoney(row.revenue),
  });
}

function toPoint(point: RevenuePoint): RevenuePointResponse {
  return Object.assign(new RevenuePointResponse(), {
    cinemaDate: point.cinemaDate,
    revenue: toMoney(point.revenue),
  });
}

function toNamedRef(ref: NamedRef): NamedRefResponse {
  return Object.assign(new NamedRefResponse(), { id: ref.id, name: ref.name });
}

function toMoney(value: Money): MoneyResponse {
  return Object.assign(new MoneyResponse(), { amount: value.amount, currency: value.currency });
}
