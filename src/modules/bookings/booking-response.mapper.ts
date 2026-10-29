import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { MoneyResponse } from '../../common/money/dto/money-response.dto';
import type { Money } from '../../common/money/types';
import type { Page } from '../../common/pagination/types';
import { formatCairoIso } from '../../common/time/time';
import { toHallLayoutResponse } from '../halls/hall-response.mapper';
import { MediaService } from '../media/media.service';
import type { Payment } from '../payments/types';
import type { SeatSnapshot } from '../seating/types';
import { toShowtimePricesResponse } from '../showtimes/showtime-response.mapper';
import { HOLD_MINUTES, MAX_SEATS_PER_HOLD } from './bookings.constants';
import {
  BookingHistoryEventPageResponse,
  BookingHistoryEventResponse,
} from './dto/booking-history-event.response';
import { BookingRefundResponse } from './dto/booking-refund.response';
import { BookingSeatResponse } from './dto/booking-seat.response';
import {
  BookingMovieResponse,
  BookingShowtimeResponse,
  BookingTheaterResponse,
  NamedRefResponse,
} from './dto/booking-showtime.response';
import {
  MyBookingPageResponse,
  MyBookingResponse,
  MyBookingTabCountsResponse,
} from './dto/my-booking.response';
import { SeatLineResponse } from './dto/seat-line.response';
import { TicketDeliveryResponse } from './dto/ticket-delivery.response';
import { BookingResponse } from './dto/booking.response';
import { HoldResponse } from './dto/hold.response';
import { PaymentResultResponse } from './dto/payment-result.response';
import { PaymentCardResponse, PaymentResponse } from './dto/payment.response';
import { ScannedBookingResponse, ScanResultResponse } from './dto/scan-result.response';
import { TicketResponse } from './dto/ticket.response';
import { PublicShowtimeResponse } from './dto/public-showtime.response';
import { SeatSnapshotResponse, TakenSeatResponse } from './dto/seat-snapshot.response';
import { inSeatOrder } from './seat-lines';
import type {
  Booking,
  BookingHistoryEvent,
  BookingRefund,
  BookingShowtime,
  CheckoutResult,
  CreatedHold,
  MyBookingsPage,
  ScanOutcome,
  SeatMapAvailability,
  ShowtimeSeatMap,
  TicketDelivery,
} from './types';

/**
 * Response DTOs of holds, bookings and the seat page: times in Cairo ISO with their offset,
 * money as `{ amount, currency }`, posters through `MediaService` (design §11). Injectable
 * because image links come from the storage adapter.
 */
@Injectable()
export class BookingResponseMapper {
  constructor(private readonly media: MediaService) {}

  booking(booking: Booking): BookingResponse {
    return Object.assign(new BookingResponse(), this.bookingFields(booking));
  }

  hold(hold: CreatedHold): HoldResponse {
    return Object.assign(new HoldResponse(), {
      ...this.bookingFields(hold.booking),
      holdCode: hold.holdCode,
    });
  }

  paymentResult(result: CheckoutResult): PaymentResultResponse {
    return Object.assign(new PaymentResultResponse(), {
      payment: toPaymentResponse(result.payment),
      booking: this.booking(result.booking),
    });
  }

  publicShowtime(map: ShowtimeSeatMap): PublicShowtimeResponse {
    return Object.assign(new PublicShowtimeResponse(), {
      ...this.showtimeFields(map.showtime),
      prices: toShowtimePricesResponse(map.prices),
      fromPrice: toMoney(map.fromPrice),
      seatCapacity: map.seatCapacity,
      layout: toHallLayoutResponse(map.layout),
      bookable: map.bookable,
      notBookableReason: map.notBookableReason,
      maxSeatsPerHold: MAX_SEATS_PER_HOLD,
      holdMinutes: HOLD_MINUTES,
    });
  }

  seatSnapshot(availability: SeatMapAvailability): SeatSnapshotResponse {
    return Object.assign(new SeatSnapshotResponse(), {
      ...snapshotFields(availability.snapshot),
      availableCount: availability.availableCount,
      soldOut: availability.soldOut,
    });
  }

  showtime(showtime: BookingShowtime): BookingShowtimeResponse {
    return Object.assign(new BookingShowtimeResponse(), this.showtimeFields(showtime));
  }

  /** `GET /me/bookings` (U12): the cards of one tab and both tabs' counts. */
  myBookingPage(page: MyBookingsPage): MyBookingPageResponse {
    return Object.assign(new MyBookingPageResponse(), {
      items: page.items.map((booking) => this.myBooking(booking)),
      nextCursor: page.nextCursor,
      total: page.total,
      tabCounts: Object.assign(new MyBookingTabCountsResponse(), {
        upcoming: page.tabCounts.upcoming,
        past: page.tabCounts.past,
      }),
    });
  }

  /** One My Bookings card (U12). */
  myBooking(booking: Booking): MyBookingResponse {
    return Object.assign(new MyBookingResponse(), {
      reference: booking.reference,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      channel: booking.channel,
      showtime: this.showtime(booking.showtime),
      seatLabels: inSeatOrder(booking.seats).map((seat) => seat.label),
      seatCount: booking.seatCount,
      total: toMoney(booking.total),
      payment: booking.payment === null ? null : toPaymentResponse(booking.payment),
      confirmedAt: booking.confirmedAt === null ? null : formatCairoIso(booking.confirmedAt),
      refund: toRefund(booking.refund),
    });
  }

  /** `GET /bookings/{ref}/history` (U12). */
  historyPage(page: Page<BookingHistoryEvent>): BookingHistoryEventPageResponse {
    return Object.assign(new BookingHistoryEventPageResponse(), {
      items: page.items.map((event) =>
        Object.assign(new BookingHistoryEventResponse(), {
          kind: event.kind,
          label: event.label,
          occurredAt: formatCairoIso(event.occurredAt),
        }),
      ),
      nextCursor: page.nextCursor,
      total: page.total,
    });
  }

  /** `POST /bookings/{ref}/ticket-deliveries` (U12). */
  ticketDelivery(delivery: TicketDelivery): TicketDeliveryResponse {
    return Object.assign(new TicketDeliveryResponse(), {
      channel: delivery.channel,
      queuedAt: formatCairoIso(delivery.queuedAt),
    });
  }

  /** `POST /admin/scans` (U13): the result, and the booking presented, if any. */
  scanResult(outcome: ScanOutcome): ScanResultResponse {
    const { booking } = outcome;
    return Object.assign(new ScanResultResponse(), {
      result: outcome.result,
      reason: outcome.reason,
      admits: outcome.admits,
      checkedInAt: outcome.checkedInAt === null ? null : formatCairoIso(outcome.checkedInAt),
      scannedAt: formatCairoIso(outcome.scannedAt),
      booking:
        booking === null
          ? null
          : Object.assign(new ScannedBookingResponse(), {
              reference: booking.reference,
              status: booking.status,
              seats: [...booking.seats],
              seatCount: booking.seatCount,
              contactName: booking.contactName,
              showtime: this.showtime(booking.showtime),
            }),
    });
  }

  private bookingFields(booking: Booking): BookingResponse {
    return {
      reference: booking.reference,
      status: booking.status,
      channel: booking.channel,
      owner: booking.owner,
      showtime: this.showtime(booking.showtime),
      seats: booking.seats.map((seat) =>
        Object.assign(new BookingSeatResponse(), {
          label: seat.label,
          rowLabel: seat.rowLabel,
          seatNumber: seat.seatNumber,
          zone: seat.zone,
          price: toMoney(seat.price),
          isWheelchair: seat.isWheelchair,
        }),
      ),
      seatCount: booking.seatCount,
      total: toMoney(booking.total),
      holdExpiresAt: formatCairoIso(booking.holdExpiresAt),
      serverTime: formatCairoIso(booking.serverTime),
      createdAt: formatCairoIso(booking.createdAt),
      confirmedAt: booking.confirmedAt === null ? null : formatCairoIso(booking.confirmedAt),
      paymentStatus: booking.paymentStatus,
      payment: booking.payment === null ? null : toPaymentResponse(booking.payment),
      ticket:
        booking.ticket === null
          ? null
          : Object.assign(new TicketResponse(), {
              qrCode: booking.ticket.qrCode,
              admits: booking.ticket.admits,
            }),
      seatLines: booking.seatLines.map((line) =>
        Object.assign(new SeatLineResponse(), {
          zone: line.zone,
          labels: [...line.labels],
          count: line.count,
          unitPrice: toMoney(line.unitPrice),
          amount: toMoney(line.amount),
        }),
      ),
      refund: toRefund(booking.refund),
    };
  }

  private showtimeFields(showtime: BookingShowtime): BookingShowtimeResponse {
    const { movie } = showtime;
    return {
      id: showtime.id,
      startsAt: formatCairoIso(showtime.startsAt),
      endsAt: formatCairoIso(showtime.endsAt),
      cinemaDate: showtime.cinemaDate,
      movie: Object.assign(new BookingMovieResponse(), {
        id: movie.id,
        title: movie.title,
        ageRating: movie.ageRating,
        runtimeMinutes: movie.runtimeMinutes,
        poster: this.media.toImageResponse(movie.poster ?? undefined, movie.title),
      }),
      theater: Object.assign(new BookingTheaterResponse(), {
        id: showtime.theater.id,
        name: showtime.theater.name,
        address: showtime.theater.address,
        district: showtime.theater.district,
        city: showtime.theater.city,
        latitude: showtime.theater.latitude,
        longitude: showtime.theater.longitude,
      }),
      hall: Object.assign(new NamedRefResponse(), showtime.hall),
    };
  }
}

/** A sale charge as the customer sees it; no internal id or provider reference leaves the API. */
export function toPaymentResponse(payment: Payment): PaymentResponse {
  if (payment.kind !== 'charge' || payment.status === 'pending') {
    throw new AppError('INTERNAL', 'Only a charge is shown as a payment.');
  }
  return Object.assign(new PaymentResponse(), {
    status: payment.status,
    method: payment.method,
    amount: toMoney(payment.amount),
    receiptReference: payment.method === 'card_terminal' ? payment.providerReference : null,
    card:
      payment.card === null
        ? null
        : Object.assign(new PaymentCardResponse(), {
            brand: payment.card.brand,
            last4: payment.card.last4,
          }),
    walletType: payment.walletType,
    createdAt: formatCairoIso(payment.createdAt),
    completedAt: payment.completedAt === null ? null : formatCairoIso(payment.completedAt),
    settlesAt:
      payment.status === 'processing' && payment.settlesAt !== null
        ? formatCairoIso(payment.settlesAt)
        : null,
  });
}

function toRefund(refund: BookingRefund | null): BookingRefundResponse | null {
  if (refund === null) return null;
  return Object.assign(new BookingRefundResponse(), {
    amount: toMoney(refund.amount),
    refundedAt: formatCairoIso(refund.refundedAt),
  });
}

function toMoney(value: Money): MoneyResponse {
  return Object.assign(new MoneyResponse(), { amount: value.amount, currency: value.currency });
}

function snapshotFields(
  snapshot: SeatSnapshot,
): Pick<SeatSnapshotResponse, 'showtimeId' | 'serverTime' | 'seats'> {
  return {
    showtimeId: snapshot.showtimeId,
    serverTime: formatCairoIso(snapshot.serverTime),
    seats: snapshot.seats.map((seat) =>
      Object.assign(new TakenSeatResponse(), {
        label: seat.label,
        state: seat.state,
        heldUntil: seat.heldUntil === null ? null : formatCairoIso(seat.heldUntil),
      }),
    ),
  };
}
