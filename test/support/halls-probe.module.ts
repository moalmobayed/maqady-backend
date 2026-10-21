import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { HallLifecycleRegistry } from '../../src/modules/halls/hall-lifecycle.registry';
import { HallsModule } from '../../src/modules/halls/halls.module';
import type { HallBlockingShowtime, HallLayout } from '../../src/modules/halls/types';

/**
 * A test-only layout participant, registered through the real `HallLifecycleRegistry` from
 * `onModuleInit` beside the real ones U7 registers (`showtime_capacity`, `hall_in_use`), standing
 * in for U10's live-claim check (`HALL_IN_USE`): it records each call in `events`, reports
 * `blocking` showtimes per hall, and throws from `afterSave` for the halls in `failAfterSave`.
 * U7's real `has_showtimes` and `has_future_showtimes` blockers need real showtimes
 * (`test/support/showtimes.ts`).
 */
@Injectable()
export class HallLifecycleProbe implements OnModuleInit {
  readonly blocking = new Map<number, HallBlockingShowtime[]>();
  readonly failAfterSave = new Set<number>();
  readonly events: string[] = [];
  readonly saved: HallLayout[] = [];

  constructor(private readonly registry: HallLifecycleRegistry) {}

  reset(): void {
    this.blocking.clear();
    this.failAfterSave.clear();
    this.events.length = 0;
    this.saved.length = 0;
  }

  onModuleInit(): void {
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
