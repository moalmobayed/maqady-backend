import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Clock } from '../../common/time/clock';
import { MovieLifecycleRegistry } from '../catalog/movie-lifecycle.registry';
import { HallLifecycleRegistry } from '../halls/hall-lifecycle.registry';
import type { HallBlockingShowtime } from '../halls/types';
import { MessageTemplateRegistry } from '../messaging/message-template.registry';
import { TheaterLifecycleRegistry } from '../theaters/theater-lifecycle.registry';
import { ShowtimeReadService } from './showtime-read.service';
import { ShowtimeSeatClaimService } from './showtime-seat-claim.service';
import { SHOWTIME_LIFECYCLE_KEYS } from './showtimes.constants';
import { ShowtimesRepository } from './showtimes.repository';
import { showtimeMovedSmsTemplate } from './templates/showtime-moved-sms.template';
import { showtimeMovedTemplate } from './templates/showtime-moved.template';

/**
 * The rules that need showtimes, plugged into the seams of the units that own the rows (design
 * §8, §9; PRD "Halls and seat maps" 4–5, "Theaters and movies" 2), and the two "showtime moved"
 * templates. Registered once at boot:
 *
 * - halls: `has_showtimes` refuses deleting a hall that ever had a showtime (it is retired
 *   instead); `has_future_showtimes` refuses retiring one with a scheduled showtime that has not
 *   ended; `showtime_capacity` locks the hall's upcoming showtimes before the hall and refreshes
 *   their seat capacity after a layout save; `hall_in_use` refuses a layout save while a
 *   showtime that has not ended has a live seat claim (`ShowtimeSeatClaimService`, U10);
 * - theaters and movies: `has_showtimes` refuses deleting one that ever had a showtime.
 *
 * Every blocker answers from one query whatever the number of halls asked about.
 */
@Injectable()
export class ShowtimeLifecycleHooks implements OnModuleInit {
  constructor(
    private readonly showtimes: ShowtimesRepository,
    private readonly reads: ShowtimeReadService,
    private readonly seatClaims: ShowtimeSeatClaimService,
    private readonly halls: HallLifecycleRegistry,
    private readonly theaters: TheaterLifecycleRegistry,
    private readonly movies: MovieLifecycleRegistry,
    private readonly templates: MessageTemplateRegistry,
    private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.halls.addDeletionBlocker({
      key: SHOWTIME_LIFECYCLE_KEYS.hasShowtimes,
      blockedIds: async (ids) => new Set(await this.showtimes.hallIdsWithShowtimes(ids)),
    });
    this.halls.addRetirementBlocker({
      key: SHOWTIME_LIFECYCLE_KEYS.hasFutureShowtimes,
      blockedIds: async (ids) =>
        new Set(await this.showtimes.hallIdsWithUnendedShowtimes(ids, this.clock.now())),
    });
    this.halls.addLayoutParticipant({
      key: SHOWTIME_LIFECYCLE_KEYS.showtimeCapacity,
      beforeLock: (hallId) => this.showtimes.lockFutureInHall(hallId, this.clock.now()),
      afterSave: async (hallId, layout) => {
        await this.showtimes.refreshCapacity(hallId, layout.seatCount, this.clock.now());
      },
    });
    this.halls.addLayoutParticipant({
      key: SHOWTIME_LIFECYCLE_KEYS.hallInUse,
      blockingShowtimes: (hallId) => this.blockingShowtimes(hallId),
    });
    this.theaters.addDeletionBlocker({
      key: SHOWTIME_LIFECYCLE_KEYS.hasShowtimes,
      blocks: (theaterId) => this.showtimes.existsForTheater(theaterId),
    });
    this.movies.addDeletionBlocker({
      key: SHOWTIME_LIFECYCLE_KEYS.hasShowtimes,
      blocks: (movieId) => this.showtimes.existsForMovie(movieId),
    });
    this.templates.register(showtimeMovedTemplate);
    this.templates.register(showtimeMovedSmsTemplate);
  }

  /** The hall's unended showtimes that have a live seat claim: one query, one seam call. */
  private async blockingShowtimes(hallId: number): Promise<readonly HallBlockingShowtime[]> {
    const unended = await this.reads.listUnendedInHall(hallId);
    if (unended.length === 0) return [];
    const claimed = await this.seatClaims.showtimeIdsWithLiveClaims(
      unended.map((showtime) => showtime.showtimeId),
    );
    return unended.filter((showtime) => claimed.has(showtime.showtimeId));
  }
}
