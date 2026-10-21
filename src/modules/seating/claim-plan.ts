import type { ClaimPlan, ClaimStatement, ClaimWriteRow } from './types';

/**
 * The order every seat-claim write follows (design §7.1 step 6): by showtime id, then by label in
 * code-point order, which is also `ORDER BY seat_label COLLATE "C"`. Any total order works as
 * long as every writer uses the same one; this is that one.
 */
export function compareSeatLabels(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Labels sorted in claim order, each once. */
export function sortedLabels(labels: Iterable<string>): string[] {
  return [...new Set(labels)].sort(compareSeatLabels);
}

/**
 * The statements one claim plan runs, in showtime id order: for each showtime, every label it
 * touches once, sorted, so the rows each statement locks (including those an `ON CONFLICT` locks
 * without updating) are never followed by a smaller label or showtime.
 *
 * - A new claim's rows carry the new booking and its `claimedUntil`.
 * - A release's rows carry their own booking and `now`, which frees the seat.
 * - Where a released label is also claimed again (a re-pick overlapping the old hold), the new
 *   claim wins, and `takeOverFrom` lets it replace the released booking's still-live claim.
 */
export function claimStatements(plan: ClaimPlan): ClaimStatement[] {
  const byShowtime = new Map<number, { rows: Map<string, ClaimWriteRow>; released: Set<number> }>();
  const statementOf = (showtimeId: number) => {
    let statement = byShowtime.get(showtimeId);
    if (!statement) {
      statement = { rows: new Map(), released: new Set() };
      byShowtime.set(showtimeId, statement);
    }
    return statement;
  };

  for (const release of plan.release) {
    const statement = statementOf(release.showtimeId);
    statement.released.add(release.bookingId);
    for (const label of release.labels) {
      if (!statement.rows.has(label)) {
        statement.rows.set(label, { label, bookingId: release.bookingId, claimedUntil: plan.now });
      }
    }
  }
  if (plan.claim) {
    const { showtimeId, bookingId, labels, claimedUntil } = plan.claim;
    const statement = statementOf(showtimeId);
    for (const label of labels) statement.rows.set(label, { label, bookingId, claimedUntil });
  }

  return [...byShowtime.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, statement]) => statement.rows.size > 0)
    .map(([showtimeId, statement]) => ({
      showtimeId,
      rows: [...statement.rows.values()].sort((a, b) => compareSeatLabels(a.label, b.label)),
      takeOverFrom: [...statement.released].sort((a, b) => a - b),
    }));
}
