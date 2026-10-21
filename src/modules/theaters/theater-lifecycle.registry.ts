import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { BUILT_IN_PUBLISH_REQUIREMENTS, NOT_DRAFT_REASON } from './theaters.constants';
import type { TheaterDeletionBlocker, TheaterPublishRequirement } from './types';

/**
 * The seams later units use to take part in a theater's lifecycle (design §9), exported by
 * `TheatersModule`:
 *
 * - U5 adds the publish requirement `active_hall` ("at least one active hall");
 * - U7 adds the deletion blocker `has_showtimes` ("only a draft with no showtimes").
 *
 * Register from the owning module's `onModuleInit`. The built-in requirements (`prices`, `hours`)
 * are checked by `TheatersService` before these, so their order never depends on start-up order.
 * A key may be registered once; a second registration is a wiring bug and fails the start.
 */
@Injectable()
export class TheaterLifecycleRegistry {
  private readonly requirements: TheaterPublishRequirement[] = [];
  private readonly blockers: TheaterDeletionBlocker[] = [];

  addPublishRequirement(requirement: TheaterPublishRequirement): void {
    const taken = [...BUILT_IN_PUBLISH_REQUIREMENTS, ...this.requirements.map(({ key }) => key)];
    if (taken.includes(requirement.key)) {
      throw new AppError('INTERNAL', `The publish requirement "${requirement.key}" is taken.`);
    }
    this.requirements.push(requirement);
  }

  addDeletionBlocker(blocker: TheaterDeletionBlocker): void {
    const taken = [NOT_DRAFT_REASON, ...this.blockers.map(({ key }) => key)];
    if (taken.includes(blocker.key)) {
      throw new AppError('INTERNAL', `The deletion blocker "${blocker.key}" is taken.`);
    }
    this.blockers.push(blocker);
  }

  /** The registered requirements, in registration order. */
  publishRequirements(): readonly TheaterPublishRequirement[] {
    return [...this.requirements];
  }

  /** The registered blockers, in registration order. */
  deletionBlockers(): readonly TheaterDeletionBlocker[] {
    return [...this.blockers];
  }
}
