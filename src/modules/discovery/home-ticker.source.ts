import { Injectable } from '@nestjs/common';
import type { CalendarDate } from '../../common/time/types';
import type { HomeTickerEntry } from './types';

/**
 * Where the home page ticker comes from (contract `TickerItem`): each Now showing movie with its
 * next bookable showtime left in the cinema day, soonest first, movies with nothing left today
 * left out. Showtimes are U7's, so U8b replaces the provider in `DiscoveryModule` with a
 * showtimes-backed source; until then the ticker is empty, and the field is always present.
 */
export abstract class HomeTickerSource {
  abstract tickerFor(now: Date, cinemaDate: CalendarDate): Promise<readonly HomeTickerEntry[]>;
}

/** The default until showtimes exist: no showtimes, so nothing to show. */
@Injectable()
export class NoShowtimesTickerSource extends HomeTickerSource {
  tickerFor(): Promise<readonly HomeTickerEntry[]> {
    return Promise.resolve([]);
  }
}
