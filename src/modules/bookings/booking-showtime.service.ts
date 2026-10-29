import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { CatalogReadService } from '../catalog/catalog-read.service';
import type { MovieRef } from '../catalog/types';
import { ShowtimeReadService } from '../showtimes/showtime-read.service';
import type { ShowtimeView } from '../showtimes/types';
import { TheaterReadService } from '../theaters/theater-read.service';
import type { TheaterDetails } from '../theaters/types';
import type { BookingShowtime, ShowtimeContext } from './types';

/**
 * The showtime around a hold or a booking, read through the exported services of showtimes,
 * theaters and catalog (design §5): its header (movie, theater, hall, time) and the statuses that
 * decide whether it can be held. Three reads whatever the showtime, never another module's table.
 *
 * `publicContext()` and `lockedContext()` hide a showtime of a draft theater (`null`), which is
 * not published (U8a); a showtime of a paused theater, a cancelled or a started showtime stays
 * visible with its reason, so a customer already on the map is told why.
 */
@Injectable()
export class BookingShowtimeService {
  constructor(
    private readonly showtimes: ShowtimeReadService,
    private readonly theaters: TheaterReadService,
    private readonly catalog: CatalogReadService,
  ) {}

  /** The publicly visible showtime, read without locks; null when unknown or unpublished. */
  async publicContext(showtimeId: number): Promise<ShowtimeContext | null> {
    const view = await this.showtimes.findById(showtimeId);
    return view ? this.visible(await this.contextOf(view)) : null;
  }

  /**
   * The showtime locked `FOR SHARE` in the open transaction (design §7.1 step 2), with its
   * theater and movie read without locks; null when unknown or unpublished.
   */
  async lockedContext(showtimeId: number): Promise<ShowtimeContext | null> {
    const view = await this.showtimes.lockForShare(showtimeId);
    return view ? this.visible(await this.contextOf(view)) : null;
  }

  /**
   * A booking's showtime locked `FOR SHARE` in the open transaction (design §7.1 step 2), with
   * its theater and movie read without locks, whatever the theater's status now (checkout, U11).
   */
  async lockedBookingContext(showtimeId: number): Promise<ShowtimeContext> {
    const view = await this.showtimes.lockForShare(showtimeId);
    if (!view)
      throw new AppError('INTERNAL', 'A booking references a showtime that does not exist.');
    return this.contextOf(view);
  }

  /**
   * A showtime read without locks, whatever its theater's status (a draft theater included, for
   * the caller to judge); null when unknown (U14 edit previews).
   */
  async anyContext(showtimeId: number): Promise<ShowtimeContext | null> {
    const view = await this.showtimes.findById(showtimeId);
    return view ? this.contextOf(view) : null;
  }

  /**
   * A showtime locked `FOR SHARE` in the open transaction (design §7.1 step 2), whatever its
   * theater's status; null when unknown (U14 edits lock the current and the target showtime).
   */
  async lockedAnyContext(showtimeId: number): Promise<ShowtimeContext | null> {
    const view = await this.showtimes.lockForShare(showtimeId);
    return view ? this.contextOf(view) : null;
  }

  /**
   * The headers of many bookings' showtimes, by showtime id, whatever their theaters' status now
   * (My Bookings, U12): three batched reads whatever their number.
   */
  async headersOf(showtimeIds: readonly number[]): Promise<ReadonlyMap<number, BookingShowtime>> {
    if (showtimeIds.length === 0) return new Map();
    // One after the other: inside a transaction they would share one connection.
    const views = await this.showtimes.findByIds(showtimeIds);
    const theaters = await this.theaters.findByIds([...views.values()].map((v) => v.theaterId));
    const movies = await this.catalog.findMoviesByIds([...views.values()].map((v) => v.movieId));
    const headers = new Map<number, BookingShowtime>();
    for (const id of new Set(showtimeIds)) {
      const view = views.get(id);
      if (!view) {
        throw new AppError('INTERNAL', 'A booking references a showtime that does not exist.');
      }
      const theater = theaters.get(view.theaterId);
      const movie = movies.get(view.movieId);
      if (!theater || !movie) throw missingParts();
      headers.set(id, headerOf(view, theater, movie));
    }
    return headers;
  }

  private visible(context: ShowtimeContext): ShowtimeContext | null {
    return context.theaterStatus === 'draft' ? null : context;
  }

  private async contextOf(view: ShowtimeView): Promise<ShowtimeContext> {
    // One after the other: inside a transaction they would share one connection.
    const theater = await this.theaters.findById(view.theaterId);
    const movie = (await this.catalog.findMoviesByIds([view.movieId])).get(view.movieId);
    if (!theater || !movie) throw missingParts();
    return {
      view,
      theaterStatus: theater.status,
      movieStatus: movie.status,
      header: headerOf(view, theater, movie),
    };
  }
}

/** A showtime's header: movie, theater with its location, hall and times. */
function headerOf(view: ShowtimeView, theater: TheaterDetails, movie: MovieRef): BookingShowtime {
  return {
    id: view.id,
    startsAt: view.startsAt,
    endsAt: view.endsAt,
    cinemaDate: view.cinemaDate,
    movie: {
      id: movie.id,
      title: movie.title,
      ageRating: movie.ageRating,
      runtimeMinutes: movie.runtimeMinutes,
      poster: movie.poster,
    },
    theater: {
      id: theater.id,
      name: theater.name,
      address: theater.address,
      district: theater.district,
      city: theater.city,
      latitude: theater.latitude,
      longitude: theater.longitude,
    },
    hall: { id: view.hallId, name: view.hallName },
  };
}

function missingParts(): AppError {
  return new AppError('INTERNAL', 'A showtime references a theater or movie that does not exist.');
}
