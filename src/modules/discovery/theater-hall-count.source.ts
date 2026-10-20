import { Injectable } from '@nestjs/common';

/**
 * How many active halls each theater has (contract `TheaterCard.hallCount`). Halls are U5's, so
 * U8b replaces the provider in `DiscoveryModule` with one that counts them in one query; every
 * theater id asked for must be in the map.
 */
export abstract class TheaterHallCountSource {
  abstract countsOf(theaterIds: readonly number[]): Promise<ReadonlyMap<number, number>>;
}

/** The default until halls exist: no theater has a hall yet. */
@Injectable()
export class NoHallsCountSource extends TheaterHallCountSource {
  countsOf(theaterIds: readonly number[]): Promise<ReadonlyMap<number, number>> {
    return Promise.resolve(new Map(theaterIds.map((id) => [id, 0])));
  }
}
