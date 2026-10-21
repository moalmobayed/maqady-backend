import { MoneyResponse } from '../../common/money/dto/money-response.dto';
import type { Money } from '../../common/money/types';
import { formatCairoIso } from '../../common/time/time';
import type { OpeningWindow, ZonePrices } from '../theaters/types';
import {
  AdminShowtimeDetailResponse,
  ShowtimeTheaterRefResponse,
} from './dto/admin-showtime-detail.response';
import {
  AdminShowtimeResponse,
  ShowtimeHallRefResponse,
  ShowtimeMovieRefResponse,
} from './dto/admin-showtime.response';
import { OpeningWindowResponse } from './dto/opening-window.response';
import { BatchItemResponse, ShowtimeBatchResponse } from './dto/showtime-batch.response';
import { DateCheckResponse, ShowtimeCheckResponse } from './dto/showtime-check.response';
import { ShowtimeConflictResponse } from './dto/showtime-conflict.response';
import { ShowtimePricesResponse } from './dto/showtime-prices.response';
import { ShowtimeTimelineResponse, TimelineHallResponse } from './dto/showtime-timeline.response';
import { SuggestedStartResponse } from './dto/suggested-start.response';
import type {
  AdminShowtime,
  AdminShowtimeDetail,
  BatchOutcome,
  DateCheck,
  HallRef,
  ShowtimeCheckOutcome,
  ShowtimeConflict,
  ShowtimeMovie,
  ShowtimeTheater,
  ShowtimeTimeline,
} from './types';

/** Response DTOs of showtimes; `toShowtimePricesResponse` is reused by U8 and U10. */

function toMoneyResponse(value: Money): MoneyResponse {
  return Object.assign(new MoneyResponse(), { amount: value.amount, currency: value.currency });
}

export function toShowtimePricesResponse(prices: ZonePrices): ShowtimePricesResponse {
  return Object.assign(new ShowtimePricesResponse(), {
    front: toMoneyResponse(prices.front),
    middle: toMoneyResponse(prices.middle),
    back: toMoneyResponse(prices.back),
  });
}

function toMovieRefResponse(movie: ShowtimeMovie): ShowtimeMovieRefResponse {
  return Object.assign(new ShowtimeMovieRefResponse(), {
    id: movie.id,
    title: movie.title,
    status: movie.status,
    runtimeMinutes: movie.runtimeMinutes,
    ageRating: movie.ageRating,
  });
}

function toHallRefResponse(hall: HallRef): ShowtimeHallRefResponse {
  return Object.assign(new ShowtimeHallRefResponse(), { id: hall.id, name: hall.name });
}

function toTheaterRefResponse(theater: ShowtimeTheater): ShowtimeTheaterRefResponse {
  return Object.assign(new ShowtimeTheaterRefResponse(), {
    id: theater.id,
    name: theater.name,
    status: theater.status,
  });
}

function toWindowResponse(window: OpeningWindow | null): OpeningWindowResponse | null {
  if (!window) return null;
  return Object.assign(new OpeningWindowResponse(), {
    opensAt: formatCairoIso(window.opensAt),
    closesAt: formatCairoIso(window.closesAt),
  });
}

function toConflictResponse(conflict: ShowtimeConflict): ShowtimeConflictResponse {
  return Object.assign(new ShowtimeConflictResponse(), {
    showtimeId: conflict.showtimeId,
    movieTitle: conflict.movieTitle,
    startsAt: formatCairoIso(conflict.startsAt),
    endsAt: formatCairoIso(conflict.endsAt),
    cleaningEndsAt: formatCairoIso(conflict.cleaningEndsAt),
  });
}

function showtimeFields(showtime: AdminShowtime): AdminShowtimeResponse {
  return {
    id: showtime.id,
    movie: toMovieRefResponse(showtime.movie),
    theaterId: showtime.theaterId,
    hall: toHallRefResponse({ id: showtime.hallId, name: showtime.hallName }),
    startsAt: formatCairoIso(showtime.startsAt),
    endsAt: formatCairoIso(showtime.endsAt),
    cleaningEndsAt: formatCairoIso(showtime.cleaningEndsAt),
    cinemaDate: showtime.cinemaDate,
    startTime: showtime.startTime,
    status: showtime.status,
    cancelReason: showtime.cancelReason,
    cancelledAt: showtime.cancelledAt ? formatCairoIso(showtime.cancelledAt) : null,
    prices: toShowtimePricesResponse(showtime.prices),
    fromPrice: toMoneyResponse(showtime.fromPrice),
    seatCapacity: showtime.seatCapacity,
    hasStarted: showtime.hasStarted,
    hasEnded: showtime.hasEnded,
    movable: showtime.movable,
    cancellable: showtime.cancellable,
    createdAt: formatCairoIso(showtime.createdAt),
    updatedAt: formatCairoIso(showtime.updatedAt),
  };
}

export function toAdminShowtimeResponse(showtime: AdminShowtime): AdminShowtimeResponse {
  return Object.assign(new AdminShowtimeResponse(), showtimeFields(showtime));
}

export function toAdminShowtimeDetailResponse(
  showtime: AdminShowtimeDetail,
): AdminShowtimeDetailResponse {
  return Object.assign(new AdminShowtimeDetailResponse(), {
    ...showtimeFields(showtime),
    theater: toTheaterRefResponse(showtime.theater),
  });
}

export function toDateCheckResponse(check: DateCheck): DateCheckResponse {
  return Object.assign(new DateCheckResponse(), {
    cinemaDate: check.cinemaDate,
    result: check.result,
    startsAt: check.span ? formatCairoIso(check.span.startsAt) : null,
    endsAt: check.span ? formatCairoIso(check.span.endsAt) : null,
    cleaningEndsAt: check.span ? formatCairoIso(check.span.cleaningEndsAt) : null,
    window: toWindowResponse(check.window),
    conflicts: check.conflicts.map(toConflictResponse),
    suggestions: check.suggestions.map((suggestion) =>
      Object.assign(new SuggestedStartResponse(), {
        startTime: suggestion.startTime,
        startsAt: formatCairoIso(suggestion.startsAt),
      }),
    ),
  });
}

export function toShowtimeCheckResponse(outcome: ShowtimeCheckOutcome): ShowtimeCheckResponse {
  return Object.assign(new ShowtimeCheckResponse(), {
    movie: toMovieRefResponse(outcome.movie),
    hall: toHallRefResponse(outcome.hall),
    theaterId: outcome.theaterId,
    startTime: outcome.startTime,
    results: outcome.results.map(toDateCheckResponse),
  });
}

export function toShowtimeBatchResponse(outcome: BatchOutcome): ShowtimeBatchResponse {
  return Object.assign(new ShowtimeBatchResponse(), {
    results: outcome.results.map((item) =>
      Object.assign(new BatchItemResponse(), {
        cinemaDate: item.cinemaDate,
        result: item.result,
        showtime: item.showtime ? toAdminShowtimeResponse(item.showtime) : null,
        conflicts: item.conflicts.map(toConflictResponse),
      }),
    ),
    createdCount: outcome.createdCount,
    skippedCount: outcome.skippedCount,
  });
}

export function toShowtimeTimelineResponse(timeline: ShowtimeTimeline): ShowtimeTimelineResponse {
  return Object.assign(new ShowtimeTimelineResponse(), {
    theater: toTheaterRefResponse(timeline.theater),
    cinemaDate: timeline.cinemaDate,
    window: toWindowResponse(timeline.window),
    specialDateLabel: timeline.specialDateLabel,
    halls: timeline.halls.map((hall) =>
      Object.assign(new TimelineHallResponse(), {
        id: hall.id,
        name: hall.name,
        status: hall.status,
        seatCount: hall.seatCount,
      }),
    ),
    items: timeline.items.map(toAdminShowtimeResponse),
    nextCursor: timeline.nextCursor,
    total: timeline.total,
  });
}
