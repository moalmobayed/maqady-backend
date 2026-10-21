import { Injectable } from '@nestjs/common';
import type { CalendarDate } from '../../common/time/types';
import { CatalogReadService } from '../catalog/catalog-read.service';
import { ShowtimeReadService } from '../showtimes/showtime-read.service';
import { TheaterReadService } from '../theaters/theater-read.service';
import type { HomeTickerEntry } from './types';

/**
 * Where the home page ticker comes from (contract `TickerItem`): each Now showing movie with its
 * next bookable showtime left in the cinema day, soonest first, movies with nothing left today
 * left out. `DiscoveryModule` binds it to `ShowtimesTickerSource`.
 */
export abstract class HomeTickerSource {
  abstract tickerFor(now: Date, cinemaDate: CalendarDate): Promise<readonly HomeTickerEntry[]>;
}

/**
 * The ticker from U7's showtimes (PRD C1): per Now showing movie, its first scheduled showtime of
 * `cinemaDate` at an `active` theater that starts after `now` (a started one can't be booked),
 * soonest first, ties by showtime id. A fixed number of queries: the active theaters, the next
 * showtime per movie (with its hall), and the movies.
 */
@Injectable()
export class ShowtimesTickerSource extends HomeTickerSource {
  constructor(
    private readonly showtimes: ShowtimeReadService,
    private readonly theaters: TheaterReadService,
    private readonly catalog: CatalogReadService,
  ) {
    super();
  }

  async tickerFor(now: Date, cinemaDate: CalendarDate): Promise<readonly HomeTickerEntry[]> {
    const theaters = new Map(
      (await this.theaters.listActive()).map((theater) => [theater.id, theater.name]),
    );
    if (theaters.size === 0) return [];
    const next = await this.showtimes.nextScheduledPerMovie({
      cinemaDate,
      after: now,
      theaterIds: [...theaters.keys()],
    });
    if (next.size === 0) return [];
    const movies = await this.catalog.findMoviesByIds([...next.keys()]);
    return [...next.values()]
      .filter((showtime) => movies.get(showtime.movieId)?.status === 'now_showing')
      .sort(
        (first, second) =>
          first.startsAt.getTime() - second.startsAt.getTime() || first.id - second.id,
      )
      .map((showtime) => ({
        movie: { id: showtime.movieId, title: movies.get(showtime.movieId)!.title },
        nextShowtime: {
          id: showtime.id,
          startsAt: showtime.startsAt,
          cinemaDate: showtime.cinemaDate,
          theater: { id: showtime.theaterId, name: theaters.get(showtime.theaterId)! },
        },
      }));
  }
}
