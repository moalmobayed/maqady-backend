import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { CatalogReadService } from '../catalog/catalog-read.service';
import { ShowtimeReadService } from '../showtimes/showtime-read.service';
import type { ShowtimeView } from '../showtimes/types';
import { TheaterReadService } from '../theaters/theater-read.service';
import type { ShowtimeContext } from './types';

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

  /** The context of a booking's showtime, whatever its theater's status now. */
  async bookingContext(showtimeId: number): Promise<ShowtimeContext> {
    const view = await this.showtimes.findById(showtimeId);
    if (!view)
      throw new AppError('INTERNAL', 'A booking references a showtime that does not exist.');
    return this.contextOf(view);
  }

  private visible(context: ShowtimeContext): ShowtimeContext | null {
    return context.theaterStatus === 'draft' ? null : context;
  }

  private async contextOf(view: ShowtimeView): Promise<ShowtimeContext> {
    // One after the other: inside a transaction they would share one connection.
    const theater = await this.theaters.findById(view.theaterId);
    const movie = (await this.catalog.findMoviesByIds([view.movieId])).get(view.movieId);
    if (!theater || !movie) {
      throw new AppError(
        'INTERNAL',
        'A showtime references a theater or movie that does not exist.',
      );
    }
    return {
      view,
      theaterStatus: theater.status,
      movieStatus: movie.status,
      header: {
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
        theater: { id: theater.id, name: theater.name },
        hall: { id: view.hallId, name: view.hallName },
      },
    };
  }
}
