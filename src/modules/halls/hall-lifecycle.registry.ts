import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import type { HallBlocker, HallLayoutParticipant } from './types';

/**
 * The seams later units use to take part in a hall's lifecycle (design §8, §9), exported by
 * `HallsModule`. The showtime and seat-claim tables arrive with U7 and U10, so their rules plug
 * in here:
 *
 * - deletion blockers: U7's `has_showtimes` ("a hall that ever had a showtime is retired");
 * - retirement blockers: U7's `has_future_showtimes` ("retiring needs no future showtimes");
 * - layout participants: U7's capacity refresh, U10's live-claim check (`HALL_IN_USE`).
 *
 * Register from the owning module's `onModuleInit`. A key may be registered once per list; a
 * second registration is a wiring bug and fails the start. Order of registration is kept.
 */
@Injectable()
export class HallLifecycleRegistry {
  private readonly deletion: HallBlocker[] = [];
  private readonly retirement: HallBlocker[] = [];
  private readonly participants: HallLayoutParticipant[] = [];

  addDeletionBlocker(blocker: HallBlocker): void {
    this.deletion.push(unique(this.deletion, blocker, 'hall deletion blocker'));
  }

  addRetirementBlocker(blocker: HallBlocker): void {
    this.retirement.push(unique(this.retirement, blocker, 'hall retirement blocker'));
  }

  addLayoutParticipant(participant: HallLayoutParticipant): void {
    this.participants.push(unique(this.participants, participant, 'hall layout participant'));
  }

  /** The registered layout participants, in registration order. */
  layoutParticipants(): readonly HallLayoutParticipant[] {
    return [...this.participants];
  }

  /**
   * For each of `hallIds`, the keys of the deletion blockers that refuse it, in registration
   * order; a hall nothing refuses has an empty list. One call per blocker, whatever the number
   * of halls.
   */
  async deletionReasons(hallIds: readonly number[]): Promise<ReadonlyMap<number, string[]>> {
    return reasonsOf(this.deletion, hallIds);
  }

  /** As `deletionReasons()`, for retiring. */
  async retirementReasons(hallIds: readonly number[]): Promise<ReadonlyMap<number, string[]>> {
    return reasonsOf(this.retirement, hallIds);
  }
}

function unique<T extends HallBlocker | HallLayoutParticipant>(
  existing: readonly T[],
  entry: T,
  what: string,
): T {
  if (existing.some(({ key }) => key === entry.key)) {
    throw new AppError('INTERNAL', `A ${what} "${entry.key}" is already registered.`);
  }
  return entry;
}

async function reasonsOf(
  blockers: readonly HallBlocker[],
  hallIds: readonly number[],
): Promise<ReadonlyMap<number, string[]>> {
  const ids = [...new Set(hallIds)];
  const reasons = new Map<number, string[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return reasons;
  // One after the other: inside a transaction they would share one connection.
  for (const blocker of blockers) {
    const blocked = await blocker.blockedIds(ids);
    for (const id of ids) if (blocked.has(id)) reasons.get(id)!.push(blocker.key);
  }
  return reasons;
}
