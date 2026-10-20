import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { HallLifecycleRegistry } from '../../src/modules/halls/hall-lifecycle.registry';
import { HallsModule } from '../../src/modules/halls/halls.module';
import type { HallBlockingShowtime, HallLayout } from '../../src/modules/halls/types';

/**
 * Test-only stand-ins for the hall rules later units register (design §8, §9), registered through
 * the real `HallLifecycleRegistry` from `onModuleInit`, the way those units will:
 *
 * - U7's deletion blocker `has_showtimes` and retirement blocker `has_future_showtimes`, which
 *   refuse the halls a suite puts in `withShowtimes` and `withFutureShowtimes`;
 * - a layout participant: U7's capacity refresh and U10's live-claim check (`HALL_IN_USE`). It
 *   records each call in `events`, reports `blocking` showtimes per hall, and throws from
 *   `afterSave` for the halls in `failAfterSave`.
 */
@Injectable()
export class HallLifecycleProbe implements OnModuleInit {
  readonly withShowtimes = new Set<number>();
  readonly withFutureShowtimes = new Set<number>();
  readonly blocking = new Map<number, HallBlockingShowtime[]>();
  readonly failAfterSave = new Set<number>();
  readonly events: string[] = [];
  readonly saved: HallLayout[] = [];

  constructor(private readonly registry: HallLifecycleRegistry) {}

  reset(): void {
    this.withShowtimes.clear();
    this.withFutureShowtimes.clear();
    this.blocking.clear();
    this.failAfterSave.clear();
    this.events.length = 0;
    this.saved.length = 0;
  }

  onModuleInit(): void {
    this.registry.addDeletionBlocker({
      key: 'has_showtimes',
      blockedIds: (ids) => Promise.resolve(new Set(ids.filter((id) => this.withShowtimes.has(id)))),
    });
    this.registry.addRetirementBlocker({
      key: 'has_future_showtimes',
      blockedIds: (ids) =>
        Promise.resolve(new Set(ids.filter((id) => this.withFutureShowtimes.has(id)))),
    });
    this.registry.addLayoutParticipant({
      key: 'test_layout_participant',
      beforeLock: (hallId) => {
        this.events.push(`beforeLock ${hallId}`);
        return Promise.resolve();
      },
      blockingShowtimes: (hallId) => {
        this.events.push(`blockingShowtimes ${hallId}`);
        return Promise.resolve(this.blocking.get(hallId) ?? []);
      },
      afterSave: (hallId, layout) => {
        this.events.push(`afterSave ${hallId}`);
        if (this.failAfterSave.has(hallId)) {
          return Promise.reject(new Error('The test participant failed after the save.'));
        }
        this.saved.push(layout);
        return Promise.resolve();
      },
    });
  }
}

@Module({ imports: [HallsModule], providers: [HallLifecycleProbe] })
export class HallsProbeModule {}
