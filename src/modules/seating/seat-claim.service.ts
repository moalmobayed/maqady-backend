import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import { claimStatements, sortedLabels } from './claim-plan';
import { SeatClaimsRepository } from './seat-claims.repository';
import type { ClaimOutcome, ClaimPlan } from './types';

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
    if (!this.context.isActive()) {
      throw new AppError('INTERNAL', 'Seat claims are written inside a transaction.');
    }
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
}
