import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/time/clock';
import { SeatClaimsRepository } from './seat-claims.repository';
import type { SeatSnapshot } from './types';

/**
 * Which seats are taken right now (design §7.2, §12), judged from `claimed_until` against the
 * `Clock`: a hold whose time ran out is free the moment it ends, with no job running. Every
 * method is one query whatever the number of showtimes.
 *
 * `showtimeIdsWithLiveClaims()` is also U7's `ShowtimeSeatClaimService`: `ShowtimesModule`
 * binds that token to this service (`useExisting`), which makes a layout save refuse with
 * `HALL_IN_USE` while an unended showtime of the hall has a live claim. Seating imports nothing
 * from showtimes (design §5); the method has the seam's exact signature.
 */
@Injectable()
export class SeatAvailabilityService {
  constructor(
    private readonly claims: SeatClaimsRepository,
    private readonly clock: Clock,
  ) {}

  /** The showtime's taken seats, by label; an unknown showtime has none. */
  async snapshot(showtimeId: number): Promise<SeatSnapshot> {
    const now = this.clock.now();
    const rows = await this.claims.live(showtimeId, now);
    return {
      showtimeId,
      serverTime: now,
      seats: rows.map((row) => ({
        label: row.seat_label,
        state: row.claimed_until === null ? 'booked' : 'held',
        heldUntil: row.claimed_until,
      })),
    };
  }

  /** How many seats of each showtime are held or sold right now; a showtime with none maps to 0. */
  async takenCounts(showtimeIds: readonly number[]): Promise<ReadonlyMap<number, number>> {
    const unique = [...new Set(showtimeIds)];
    const counts = new Map<number, number>(unique.map((id) => [id, 0]));
    for (const row of await this.claims.takenCounts(unique, this.clock.now())) {
      counts.set(row.showtime_id, row.taken);
    }
    return counts;
  }

  /** The showtimes among these with a seat held or sold right now (U7's `HALL_IN_USE`). */
  async showtimeIdsWithLiveClaims(showtimeIds: readonly number[]): Promise<ReadonlySet<number>> {
    const rows = await this.claims.takenCounts([...new Set(showtimeIds)], this.clock.now());
    return new Set(rows.filter((row) => row.taken > 0).map((row) => row.showtime_id));
  }
}
