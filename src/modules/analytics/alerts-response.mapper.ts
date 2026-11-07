import { Injectable } from '@nestjs/common';
import { formatCairoIso } from '../../common/time/time';
import { NamedRefResponse } from '../bookings/dto/booking-showtime.response';
import {
  AdminAlertPageResponse,
  AdminAlertResponse,
  AlertReadResultResponse,
  FailedPaymentsAlertResponse,
  HallGapAlertResponse,
  LowSalesAlertResponse,
} from './dto/admin-alert.response';
import type { AlertPage, AlertReadResult, NamedRef, StaffAlert } from './types';

/** Response DTOs of the bell (U17): times in Cairo ISO. */
@Injectable()
export class AlertsResponseMapper {
  page(page: AlertPage): AdminAlertPageResponse {
    return Object.assign(new AdminAlertPageResponse(), {
      items: page.items.map((alert) => this.alert(alert)),
      nextCursor: page.nextCursor,
      total: page.total,
      unreadCount: page.unreadCount,
      cinemaDate: page.cinemaDate,
      serverTime: formatCairoIso(page.serverTime),
    });
  }

  alert(alert: StaffAlert): AdminAlertResponse {
    return Object.assign(new AdminAlertResponse(), {
      key: alert.key,
      kind: alert.kind,
      cinemaDate: alert.cinemaDate,
      title: alert.title,
      read: alert.read,
      readAt: alert.readAt === null ? null : formatCairoIso(alert.readAt),
      failedPayments:
        alert.failedPayments === null
          ? null
          : Object.assign(new FailedPaymentsAlertResponse(), {
              count: alert.failedPayments.count,
            }),
      lowSales:
        alert.lowSales === null
          ? null
          : Object.assign(new LowSalesAlertResponse(), {
              showtimeId: alert.lowSales.showtimeId,
              startsAt: formatCairoIso(alert.lowSales.startsAt),
              movie: toNamedRef(alert.lowSales.movie),
              theater: toNamedRef(alert.lowSales.theater),
              hall: toNamedRef(alert.lowSales.hall),
              ticketsSold: alert.lowSales.ticketsSold,
              seatCapacity: alert.lowSales.seatCapacity,
              soldShare: alert.lowSales.soldShare,
            }),
      hallGap:
        alert.hallGap === null
          ? null
          : Object.assign(new HallGapAlertResponse(), {
              hall: toNamedRef(alert.hallGap.hall),
              theater: toNamedRef(alert.hallGap.theater),
            }),
    });
  }

  readResult(result: AlertReadResult): AlertReadResultResponse {
    return Object.assign(new AlertReadResultResponse(), {
      markedCount: result.markedCount,
      unreadCount: result.unreadCount,
      total: result.total,
    });
  }
}

function toNamedRef(ref: NamedRef): NamedRefResponse {
  return Object.assign(new NamedRefResponse(), { id: ref.id, name: ref.name });
}
