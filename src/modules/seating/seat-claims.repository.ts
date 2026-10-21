import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../../common/database/transaction-context';
import type { ClaimStatement, SeatClaimRow, TakenCountRow, WrittenClaimRow } from './types';

/** A claim is live (the seat is taken) while it is sold or its end is still ahead (§7.2). */
const LIVE = '(claimed_until IS NULL OR claimed_until > ?)';

/**
 * `seat_claims` (design §7.2). The claim statement is the only write here, and every read judges
 * a claim live from `claimed_until` against the `now` it is given (the service's `Clock`), so an
 * expired hold frees its seats without anything running.
 */
@Injectable()
export class SeatClaimsRepository {
  constructor(private readonly db: TransactionContext) {}

  /**
   * One showtime's claim statement (design §7.2): every row inserted in the given order (sorted
   * by label), and on a conflict the existing claim taken over only when it is not sold and has
   * ended, or belongs to a booking this transaction is releasing. A row whose condition fails is
   * still locked (`ON CONFLICT DO UPDATE`), which is why the order matters. Returns the rows
   * written, as `{ seat_label, booking_id }`.
   */
  async upsert(statement: ClaimStatement, now: Date): Promise<WrittenClaimRow[]> {
    const { rows } = statement;
    if (rows.length === 0) return [];
    const result = await this.db.executor().raw<{ rows: WrittenClaimRow[] }>(
      `INSERT INTO seat_claims (showtime_id, seat_label, booking_id, claimed_until)
       SELECT ?::bigint, r.label, r.booking_id, r.claimed_until
       FROM unnest(?::text[], ?::bigint[], ?::timestamptz[]) WITH ORDINALITY
         AS r(label, booking_id, claimed_until, n)
       ORDER BY r.n
       ON CONFLICT (showtime_id, seat_label) DO UPDATE
         SET booking_id = EXCLUDED.booking_id, claimed_until = EXCLUDED.claimed_until
         WHERE seat_claims.claimed_until IS NOT NULL
           AND (seat_claims.claimed_until <= ?
                OR seat_claims.booking_id = ANY(?::bigint[]))
       RETURNING seat_label, booking_id`,
      [
        statement.showtimeId,
        rows.map((row) => row.label),
        rows.map((row) => row.bookingId),
        // node-pg sends null elements as SQL NULL; Knex's types only allow non-null arrays.
        rows.map((row) => row.claimedUntil) as unknown as Date[],
        now,
        [...statement.takeOverFrom],
      ],
    );
    return result.rows;
  }

  /** The showtime's live claims at `now`, by label in claim order. */
  async live(showtimeId: number, now: Date): Promise<SeatClaimRow[]> {
    const result = await this.db.executor().raw<{ rows: SeatClaimRow[] }>(
      `SELECT seat_label, booking_id, claimed_until FROM seat_claims
       WHERE showtime_id = ? AND ${LIVE}
       ORDER BY seat_label COLLATE "C"`,
      [showtimeId, now],
    );
    return result.rows;
  }

  /** How many seats of each of these showtimes have a live claim at `now`; none are absent. */
  async takenCounts(showtimeIds: readonly number[], now: Date): Promise<TakenCountRow[]> {
    if (showtimeIds.length === 0) return [];
    const result = await this.db.executor().raw<{ rows: TakenCountRow[] }>(
      `SELECT showtime_id, count(*)::int AS taken FROM seat_claims
       WHERE showtime_id = ANY(?::bigint[]) AND ${LIVE}
       GROUP BY showtime_id`,
      [[...showtimeIds], now],
    );
    return result.rows;
  }
}
