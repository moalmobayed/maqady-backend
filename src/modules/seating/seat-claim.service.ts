import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import { claimStatements, sortedLabels } from './claim-plan';
import { SeatClaimsRepository } from './seat-claims.repository';
import type {
  BookingClaims,
  ChangedClaimRow,
  ClaimOutcome,
  ClaimPlan,
  LockedClaimRow,
  ShowtimeSeats,
} from './types';

/**
 * Writes seat claims (design §7.2), for holds now and for confirmation, counter sales and edits
 * later (U11, U13, U14). Call it in the open transaction, after locking the showtime, the hall,
 * the principal and the bookings involved (§7.1 steps 2–5): it is step 6.
 *
 * `write()` runs one statement per showtime, in showtime id order, each with its labels sorted.
 * A released booking's seats are freed in the same statement as the new claim, so a re-pick
 * that overlaps its old hold keeps the shared seat and locks nothing out of order. A sold seat
 * (`claimed_until` NULL) is never touched, not even by a release.
 */
@Injectable()
export class SeatClaimService {
  constructor(
    private readonly claims: SeatClaimsRepository,
    private readonly context: TransactionContext,
  ) {}

  async write(plan: ClaimPlan): Promise<ClaimOutcome> {
    this.requireTransaction();
    const claimed = new Set<string>();
    for (const statement of claimStatements(plan)) {
      const written = await this.claims.upsert(statement, plan.now);
      if (plan.claim && statement.showtimeId === plan.claim.showtimeId) {
        for (const row of written) {
          if (row.booking_id === plan.claim.bookingId) claimed.add(row.seat_label);
        }
      }
    }
    const requested = sortedLabels(plan.claim?.labels ?? []);
    return {
      claimed: requested.filter((label) => claimed.has(label)),
      missing: requested.filter((label) => !claimed.has(label)),
    };
  }

  /**
   * Locks the claims of these seats `FOR UPDATE` in claim order (design §7.1 step 6), for checkout
   * and settlement (U11): from here no rival hold can take them (its upsert waits on these row
   * locks, then sees them still claimed). Returns the rows as locked; a seat with no row is absent.
   */
  async lockFor(seats: readonly ShowtimeSeats[]): Promise<readonly LockedClaimRow[]> {
    this.requireTransaction();
    return this.claims.lockFor(seats.map(sortedGroup));
  }

  /**
   * Makes these bookings' held claims sold (`claimed_until = NULL`, design §7.5 step 6), so nothing
   * ever overwrites them. Returns how many seats changed, for the caller to check against the
   * seat count. Lock them first with `lockFor()`.
   */
  async confirm(claims: readonly BookingClaims[]): Promise<number> {
    this.requireTransaction();
    return (await this.claims.confirm(claims.map(sortedGroup))).length;
  }

  /** Moves the end of a booking's held claims to `until` (a processing payment, §7.5); the count. */
  async extend(claims: BookingClaims, until: Date): Promise<number> {
    this.requireTransaction();
    return (await this.claims.extend(sortedGroup(claims), until)).length;
  }

  /**
   * Deletes these bookings' claims, sold or held (design §7.2 "Refunds"), and returns the seats
   * freed by showtime, labels sorted, for `seat.released`. Lock them first with `lockFor()`.
   */
  async deleteOwn(claims: readonly BookingClaims[]): Promise<readonly ShowtimeSeats[]> {
    this.requireTransaction();
    return groupByShowtime(await this.claims.deleteOwn(claims.map(sortedGroup)));
  }

  private requireTransaction(): void {
    if (!this.context.isActive()) {
      throw new AppError('INTERNAL', 'Seat claims are written inside a transaction.');
    }
  }
}

function sortedGroup<T extends ShowtimeSeats>(group: T): T {
  return { ...group, labels: sortedLabels(group.labels) };
}

function groupByShowtime(rows: readonly ChangedClaimRow[]): ShowtimeSeats[] {
  const byShowtime = new Map<number, string[]>();
  for (const row of rows) {
    byShowtime.set(row.showtime_id, [...(byShowtime.get(row.showtime_id) ?? []), row.seat_label]);
  }
  return [...byShowtime.entries()]
    .sort(([a], [b]) => a - b)
    .map(([showtimeId, labels]) => ({ showtimeId, labels: sortedLabels(labels) }));
}
