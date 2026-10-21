import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../../common/database/transaction-context';
import type {
  BookingClaims,
  ChangedClaimRow,
  ClaimKeyArrays,
  ClaimStatement,
  LockedClaimRow,
  SeatClaimRow,
  ShowtimeSeats,
  TakenCountRow,
  WrittenClaimRow,
} from './types';

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

  /**
   * Locks these seats' claim rows `FOR UPDATE` in claim order, by showtime id then label (design
   * §7.1 step 6), and returns them as they are once locked; a seat with no row is absent. The
   * sort sits below the lock in the plan, so rows are locked in that order.
   */
  async lockFor(seats: readonly ShowtimeSeats[]): Promise<LockedClaimRow[]> {
    const keys = flatten(seats);
    if (keys.showtimeIds.length === 0) return [];
    const result = await this.db.executor().raw<{ rows: LockedClaimRow[] }>(
      `SELECT sc.showtime_id, sc.seat_label, sc.booking_id, sc.claimed_until
       FROM seat_claims AS sc
       JOIN unnest(?::bigint[], ?::text[]) AS k(showtime_id, seat_label)
         ON sc.showtime_id = k.showtime_id AND sc.seat_label = k.seat_label
       ORDER BY sc.showtime_id, sc.seat_label COLLATE "C"
       FOR UPDATE OF sc`,
      [keys.showtimeIds, keys.labels],
    );
    return result.rows;
  }

  /**
   * Makes these bookings' held claims permanent (`claimed_until = NULL`, a sold seat that nothing
   * overwrites, design §7.2); returns the seats changed. Only a booking's own, not yet sold claims
   * change. Call it with the rows locked by `lockFor()`.
   */
  async confirm(claims: readonly BookingClaims[]): Promise<ChangedClaimRow[]> {
    const keys = flatten(claims);
    if (keys.showtimeIds.length === 0) return [];
    const result = await this.db.executor().raw<{ rows: ChangedClaimRow[] }>(
      `UPDATE seat_claims AS sc SET claimed_until = NULL
       FROM unnest(?::bigint[], ?::text[], ?::bigint[]) AS k(showtime_id, seat_label, booking_id)
       WHERE sc.showtime_id = k.showtime_id AND sc.seat_label = k.seat_label
         AND sc.booking_id = k.booking_id AND sc.claimed_until IS NOT NULL
       RETURNING sc.showtime_id, sc.seat_label`,
      [keys.showtimeIds, keys.labels, keys.bookingIds],
    );
    return result.rows;
  }

  /** Moves the end of one booking's held claims to `until`; returns the seats changed. */
  async extend(claims: BookingClaims, until: Date): Promise<ChangedClaimRow[]> {
    if (claims.labels.length === 0) return [];
    const result = await this.db.executor().raw<{ rows: ChangedClaimRow[] }>(
      `UPDATE seat_claims SET claimed_until = ?
       WHERE showtime_id = ? AND booking_id = ? AND seat_label = ANY(?::text[])
         AND claimed_until IS NOT NULL
       RETURNING showtime_id, seat_label`,
      [until, claims.showtimeId, claims.bookingId, [...claims.labels]],
    );
    return result.rows;
  }

  /** Deletes these bookings' own claims on these seats, sold or held; returns the seats freed. */
  async deleteOwn(claims: readonly BookingClaims[]): Promise<ChangedClaimRow[]> {
    const keys = flatten(claims);
    if (keys.showtimeIds.length === 0) return [];
    const result = await this.db.executor().raw<{ rows: ChangedClaimRow[] }>(
      `DELETE FROM seat_claims AS sc
       USING unnest(?::bigint[], ?::text[], ?::bigint[]) AS k(showtime_id, seat_label, booking_id)
       WHERE sc.showtime_id = k.showtime_id AND sc.seat_label = k.seat_label
         AND sc.booking_id = k.booking_id
       RETURNING sc.showtime_id, sc.seat_label`,
      [keys.showtimeIds, keys.labels, keys.bookingIds],
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

/** Parallel arrays of every seat named, for `unnest`; a booking id of 0 when none is given. */
function flatten(groups: readonly (ShowtimeSeats | BookingClaims)[]): ClaimKeyArrays {
  const showtimeIds: number[] = [];
  const labels: string[] = [];
  const bookingIds: number[] = [];
  for (const group of groups) {
    for (const label of group.labels) {
      showtimeIds.push(group.showtimeId);
      labels.push(label);
      bookingIds.push('bookingId' in group ? group.bookingId : 0);
    }
  }
  return { showtimeIds, labels, bookingIds };
}
