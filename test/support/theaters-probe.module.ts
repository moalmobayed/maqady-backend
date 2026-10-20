import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { TheaterLifecycleRegistry } from '../../src/modules/theaters/theater-lifecycle.registry';
import { TheatersModule } from '../../src/modules/theaters/theaters.module';

/**
 * Test-only stand-ins for the lifecycle rules later units register (design §9): U5's publish
 * requirement `active_hall` and U7's deletion blocker `has_showtimes`, registered the way those
 * units will, from `onModuleInit`. A suite sets which theaters meet or are blocked.
 */
@Injectable()
export class TheaterLifecycleProbe implements OnModuleInit {
  /** Theaters that "have an active hall". */
  readonly withActiveHall = new Set<number>();
  /** Theaters that "have showtimes". */
  readonly withShowtimes = new Set<number>();

  constructor(private readonly registry: TheaterLifecycleRegistry) {}

  onModuleInit(): void {
    this.registry.addPublishRequirement({
      key: 'active_hall',
      isMet: (theaterId) => Promise.resolve(this.withActiveHall.has(theaterId)),
    });
    this.registry.addDeletionBlocker({
      key: 'has_showtimes',
      blocks: (theaterId) => Promise.resolve(this.withShowtimes.has(theaterId)),
    });
  }
}

@Module({ imports: [TheatersModule], providers: [TheaterLifecycleProbe] })
export class TheaterLifecycleProbeModule {}
