import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import type { MovieDeletionBlocker } from './types';

/**
 * The seam other units use to refuse a movie's deletion (design §9 "a movie that ever had a
 * booking can't be deleted"). U7 registers `has_showtimes` and U10 `has_bookings` from their
 * modules' `onModuleInit`; the catalog doesn't know their tables.
 */
@Injectable()
export class MovieLifecycleRegistry {
  private readonly blockers: MovieDeletionBlocker[] = [];

  /** Adds a blocker. Two blockers with one key is a wiring bug, so it throws. */
  addDeletionBlocker(blocker: MovieDeletionBlocker): void {
    if (this.blockers.some((existing) => existing.key === blocker.key)) {
      throw new AppError(
        'INTERNAL',
        `A movie deletion blocker "${blocker.key}" is already registered.`,
      );
    }
    this.blockers.push(blocker);
  }

  /**
   * The keys of the blockers that refuse deleting this movie, in registration order. Called in
   * the delete's transaction with the movie locked; the blockers run one after another on it.
   */
  async deletionBlockersOf(movieId: number): Promise<string[]> {
    const reasons: string[] = [];
    for (const blocker of this.blockers) {
      if (await blocker.blocks(movieId)) reasons.push(blocker.key);
    }
    return reasons;
  }
}
