import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { TheaterLifecycleRegistry } from '../../src/modules/theaters/theater-lifecycle.registry';
import { TheatersModule } from '../../src/modules/theaters/theaters.module';

/**
 * A test-only stand-in for the lifecycle rule a later unit registers (design §9): U7's deletion
 * blocker `has_showtimes`, registered the way U7 will, from `onModuleInit`. A suite sets which
 * theaters are blocked. U5's publish requirement `active_hall` is real: suites add an active
 * hall with `addActiveHall()` (`test/support/halls.ts`).
 */
@Injectable()
export class TheaterLifecycleProbe implements OnModuleInit {
  /** Theaters that "have showtimes". */
  readonly withShowtimes = new Set<number>();

  constructor(private readonly registry: TheaterLifecycleRegistry) {}

  onModuleInit(): void {
    this.registry.addDeletionBlocker({
      key: 'has_showtimes',
      blocks: (theaterId) => Promise.resolve(this.withShowtimes.has(theaterId)),
    });
  }
}

@Module({ imports: [TheatersModule], providers: [TheaterLifecycleProbe] })
export class TheaterLifecycleProbeModule {}
