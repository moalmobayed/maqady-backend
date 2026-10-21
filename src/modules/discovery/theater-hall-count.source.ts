import { Injectable } from '@nestjs/common';
import { HallReadService } from '../halls/hall-read.service';

/**
 * How many active halls each theater has (contract `TheaterCard.hallCount`); every theater id
 * asked for is in the map. `DiscoveryModule` binds it to `ActiveHallCountSource`.
 */
export abstract class TheaterHallCountSource {
  abstract countsOf(theaterIds: readonly number[]): Promise<ReadonlyMap<number, number>>;
}

/**
 * The hall counts from U5's halls: the `active` ones (a draft or retired hall is not open to
 * customers), read for every theater at once through `HallReadService.listByTheaters()`.
 */
@Injectable()
export class ActiveHallCountSource extends TheaterHallCountSource {
  constructor(private readonly halls: HallReadService) {
    super();
  }

  async countsOf(theaterIds: readonly number[]): Promise<ReadonlyMap<number, number>> {
    if (theaterIds.length === 0) return new Map();
    const halls = await this.halls.listByTheaters(theaterIds, ['active']);
    return new Map(theaterIds.map((id) => [id, halls.get(id)?.length ?? 0]));
  }
}
