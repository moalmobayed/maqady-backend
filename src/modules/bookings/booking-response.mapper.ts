import { Injectable } from '@nestjs/common';
import { MoneyResponse } from '../../common/money/dto/money-response.dto';
import type { Money } from '../../common/money/types';
import { formatCairoIso } from '../../common/time/time';
import { toHallLayoutResponse } from '../halls/hall-response.mapper';
import { MediaService } from '../media/media.service';
import type { SeatSnapshot } from '../seating/types';
import { toShowtimePricesResponse } from '../showtimes/showtime-response.mapper';
import { HOLD_MINUTES, MAX_SEATS_PER_HOLD } from './bookings.constants';
import { BookingSeatResponse } from './dto/booking-seat.response';
import {
  BookingMovieResponse,
  BookingShowtimeResponse,
  NamedRefResponse,
} from './dto/booking-showtime.response';
import { BookingResponse } from './dto/booking.response';
import { HoldResponse } from './dto/hold.response';
import { PublicShowtimeResponse } from './dto/public-showtime.response';
import { SeatSnapshotResponse, TakenSeatResponse } from './dto/seat-snapshot.response';
import type {
  Booking,
  BookingShowtime,
  CreatedHold,
  SeatMapAvailability,
  ShowtimeSeatMap,
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
      theater: Object.assign(new NamedRefResponse(), showtime.theater),
      hall: Object.assign(new NamedRefResponse(), showtime.hall),
    };
  }
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
