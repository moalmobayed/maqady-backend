import { AppError } from '../../common/errors/app-error';
import { money } from '../../common/money/money';
import { cairoWallClockOf } from '../../common/time/time';
import type { MovieRef } from '../catalog/types';
import type { HallSummary } from '../halls/types';
import type { ZonePrices } from '../theaters/types';
import { fromPrice } from './showtime-time';
import type { AdminShowtime, BusySlot, BusySlotRow, ShowtimeRow, ShowtimeView } from './types';

/** Row-to-model conversions of `showtimes`, shared by the read and admin services. */

/** The three zone prices of a row. */
export function pricesOf(row: ShowtimeRow): ZonePrices {
  return {
    front: money(row.price_front, row.currency),
    middle: money(row.price_middle, row.currency),
    back: money(row.price_back, row.currency),
  };
}

/** A showtime as other units read it, with its hall's name and its "from" price. */
export function toShowtimeView(row: ShowtimeRow, hall: HallSummary | undefined): ShowtimeView {
  if (!hall) throw new AppError('INTERNAL', 'A showtime references a hall that does not exist.');
  const prices = pricesOf(row);
  return {
    id: row.id,
    movieId: row.movie_id,
    theaterId: row.theater_id,
    hallId: row.hall_id,
    hallName: hall.name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    cleaningEndsAt: row.cleaning_ends_at,
    cinemaDate: row.cinema_date,
    status: row.status,
    cancelReason: row.cancel_reason,
    cancelledAt: row.cancelled_at,
    prices,
    fromPrice: fromPrice(prices, hall.zoneSeatCounts),
    seatCapacity: row.seat_capacity,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** A showtime as the admin timeline and manage panel show it, judged at `now`. */
export function toAdminShowtime(
  view: ShowtimeView,
  movie: MovieRef | undefined,
  now: Date,
): AdminShowtime {
  if (!movie) throw new AppError('INTERNAL', 'A showtime references a movie that does not exist.');
  const hasStarted = view.startsAt.getTime() <= now.getTime();
  const hasEnded = view.endsAt.getTime() <= now.getTime();
  const scheduled = view.status === 'scheduled';
  return {
    ...view,
    movie: {
      id: movie.id,
      title: movie.title,
      status: movie.status,
      runtimeMinutes: movie.runtimeMinutes,
      ageRating: movie.ageRating,
    },
    startTime: cairoWallClockOf(view.startsAt),
    hasStarted,
    hasEnded,
    movable: scheduled && !hasStarted,
    cancellable: scheduled && !hasEnded,
  };
}

export function toBusySlot(row: BusySlotRow): BusySlot {
  return {
    id: row.id,
    movieId: row.movie_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    cleaningEndsAt: row.cleaning_ends_at,
  };
}
