import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { CatalogModule } from '../../src/modules/catalog/catalog.module';
import { MovieLifecycleRegistry } from '../../src/modules/catalog/movie-lifecycle.registry';

/**
 * Stands in for U10's `has_bookings` deletion blocker, which needs bookings this unit doesn't
 * have: it blocks the movies a test puts in `bookedMovieIds`. Registered through the real
 * `MovieLifecycleRegistry`, exactly as U10 will.
 */
@Injectable()
export class TestBookingsBlocker implements OnModuleInit {
  readonly bookedMovieIds = new Set<number>();

  constructor(private readonly lifecycle: MovieLifecycleRegistry) {}

  onModuleInit(): void {
    this.lifecycle.addDeletionBlocker({
      key: 'has_bookings',
      blocks: (movieId) => Promise.resolve(this.bookedMovieIds.has(movieId)),
    });
  }
}

@Module({ imports: [CatalogModule], providers: [TestBookingsBlocker] })
export class CatalogProbeModule {}
