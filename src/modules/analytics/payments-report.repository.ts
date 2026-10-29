import { Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { TransactionContext } from '../../common/database/transaction-context';
import type { PageRequest } from '../../common/pagination/types';
import type { InstantRange } from '../payments/types';
import { OCCURRED_AT_SQL, transactionConditions } from './transactions.sql';
import type {
  BalanceMismatchRow,
  OnlineCheckRow,
  OverRefundRow,
  PeriodAggregateRow,
  TransactionFilter,
  TransactionRow,
} from './types';

const TRANSACTION_COLUMNS = [
  'p.id',
  'p.booking_id',
  'p.kind',
  'p.purpose',
  'p.method',
  'p.status',
  'p.amount',
  'p.currency',
  'p.refund_of_payment_id',
  'p.provider_reference',
  'p.card_brand',
  'p.card_last4',
  'p.wallet_type',
  'p.collected_by_staff_id',
  'p.paid_out_at',
  'p.paid_out_by_staff_id',
  'p.created_at',
  'p.completed_at',
  'b.reference AS booking_reference',
  'b.channel AS booking_channel',
  'b.contact_name',
  's.theater_id',
  't.name AS theater_name',
] as const;

/**
 * A charge's succeeded and pending refunds, one lateral sub-select per page row inside the one
 * page query (`idx_payments_refund_of_payment_id`); 0 for a refund row.
 */
const REFUND_SUMS_JOIN = `LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(r.amount) FILTER (WHERE r.status = 'succeeded'), 0) AS refunded,
         COALESCE(SUM(r.amount) FILTER (WHERE r.status = 'pending'), 0) AS pending
  FROM payments AS r WHERE r.refund_of_payment_id = p.id) AS rf ON true`;

/**
 * The Payments screen's reads (U16; design §5: `analytics` is a read-only module with its own
 * queries over the tables it reports on, §13.3). Every method is one statement on the current
 * executor; nothing here writes. Every payment's booking has a showtime and that a theater (NOT
 * NULL foreign keys), so the inner joins drop no row. All money is EGP (`chk_payments_currency`).
 */
@Injectable()
export class PaymentsReportRepository {
  constructor(private readonly db: TransactionContext) {}

  /**
   * Up to `limit + 1` transactions after the cursor, newest `occurredAt` first, then id
   * (`idx_payments_occurred_at`).
   */
  async page(filter: TransactionFilter, page: PageRequest): Promise<TransactionRow[]> {
    const query = this.transactions(filter)
      .select<TransactionRow[]>([
        ...TRANSACTION_COLUMNS,
        this.db.executor().raw(`${OCCURRED_AT_SQL} AS occurred_at`),
        this.db.executor().raw('rf.refunded AS refunded_amount'),
        this.db.executor().raw('rf.pending AS pending_refund_amount'),
      ])
      .joinRaw(REFUND_SUMS_JOIN)
      .orderByRaw(`${OCCURRED_AT_SQL} DESC, p.id DESC`)
      .limit(page.limit + 1);
    if (page.after) {
      query.andWhereRaw(`(${OCCURRED_AT_SQL}, p.id) < (?, ?)`, [
        new Date(String(page.after.sortKey)),
        page.after.id,
      ]);
    }
    return query;
  }

  /** How many transactions match these filters. */
  async count(filter: TransactionFilter): Promise<number> {
    const row = await this.transactions(filter)
      .count<{ count: number }[]>({ count: 'p.id' })
      .first();
    return row?.count ?? 0;
  }

  /**
   * The money whose `completed_at` falls in `[from, to)`, by theater, kind and method: succeeded
   * sums and counts, and the declined and cancelled charges (`idx_payments_completed_at`). A
   * counter refund counts once paid out, when it completes.
   */
  async periodAggregates(range: InstantRange): Promise<PeriodAggregateRow[]> {
    const result = await this.db.executor().raw<{ rows: PeriodAggregateRow[] }>(
      `SELECT s.theater_id, t.name AS theater_name, p.kind, p.method,
              COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'succeeded'), 0) AS succeeded_amount,
              COUNT(*) FILTER (WHERE p.status = 'succeeded') AS succeeded_count,
              COUNT(*) FILTER (WHERE p.status = 'declined') AS declined_count,
              COUNT(*) FILTER (WHERE p.status = 'cancelled') AS cancelled_count
       FROM payments AS p
       JOIN bookings AS b ON b.id = p.booking_id
       JOIN showtimes AS s ON s.id = b.showtime_id
       JOIN theaters AS t ON t.id = s.theater_id
       WHERE p.completed_at >= ? AND p.completed_at < ?
       GROUP BY s.theater_id, t.name, p.kind, p.method
       ORDER BY t.name, s.theater_id, p.kind, p.method`,
      [range.from, range.to],
    );
    return result.rows;
  }

  /**
   * The online rows completed in `[from, to)` that the provider check reads: charges final in the
   * ledger (succeeded, declined, cancelled) and succeeded online refunds, in id order
   * (`idx_payments_completed_at`).
   */
  async onlineRowsCompletedBetween(range: InstantRange): Promise<OnlineCheckRow[]> {
    const result = await this.db.executor().raw<{ rows: OnlineCheckRow[] }>(
      `SELECT p.id, p.kind, p.status, p.amount, p.currency, p.provider_reference,
              b.reference AS booking_reference
       FROM payments AS p
       JOIN bookings AS b ON b.id = p.booking_id
       WHERE p.completed_at >= ? AND p.completed_at < ? AND p.method IN ('card', 'wallet')
       ORDER BY p.id`,
      [range.from, range.to],
    );
    return result.rows;
  }

  /**
   * Up to `limit` bookings touched in `[from, to)` (a payment with its `occurredAt` in it, or
   * confirmed or refunded in it) whose succeeded charges minus refunds (pending ones included:
   * they are owed) differ from what the booking should hold: its total while `confirmed`, nothing
   * while `held` or `refunded`. In id order.
   */
  async balanceMismatches(range: InstantRange, limit: number): Promise<BalanceMismatchRow[]> {
    const result = await this.db.executor().raw<{ rows: BalanceMismatchRow[] }>(
      `WITH touched AS (
         SELECT booking_id AS id FROM payments AS p
         WHERE ${OCCURRED_AT_SQL} >= ? AND ${OCCURRED_AT_SQL} < ?
         UNION
         SELECT id FROM bookings WHERE confirmed_at >= ? AND confirmed_at < ?
         UNION
         SELECT id FROM bookings WHERE refunded_at >= ? AND refunded_at < ?
       ),
       balances AS (
         SELECT b.id, b.reference, b.status, b.currency,
                CASE WHEN b.status = 'confirmed' THEN b.total_amount ELSE 0 END AS expected,
                COALESCE(SUM(CASE
                  WHEN p.kind = 'charge' AND p.status = 'succeeded' THEN p.amount
                  WHEN p.kind = 'refund' THEN -p.amount
                  ELSE 0 END), 0) AS actual
         FROM touched
         JOIN bookings AS b ON b.id = touched.id
         LEFT JOIN payments AS p ON p.booking_id = b.id
         GROUP BY b.id
       )
       SELECT id AS booking_id, reference, status, currency, expected, actual
       FROM balances WHERE actual <> expected
       ORDER BY id
       LIMIT ?`,
      [range.from, range.to, range.from, range.to, range.from, range.to, limit],
    );
    return result.rows;
  }

  /**
   * Up to `limit` charges with a refund whose `occurredAt` falls in `[from, to)` and whose refunds
   * add up to more than the charge took, in id order (`idx_payments_refund_of_payment_id`).
   */
  async overRefunds(range: InstantRange, limit: number): Promise<OverRefundRow[]> {
    const result = await this.db.executor().raw<{ rows: OverRefundRow[] }>(
      `SELECT c.id AS payment_id, b.reference, c.currency, c.amount, SUM(r.amount) AS refunded
       FROM payments AS c
       JOIN bookings AS b ON b.id = c.booking_id
       JOIN payments AS r ON r.refund_of_payment_id = c.id
       WHERE c.id IN (
         SELECT p.refund_of_payment_id FROM payments AS p
         WHERE p.kind = 'refund' AND ${OCCURRED_AT_SQL} >= ? AND ${OCCURRED_AT_SQL} < ?)
       GROUP BY c.id, b.reference
       HAVING SUM(r.amount) > c.amount
       ORDER BY c.id
       LIMIT ?`,
      [range.from, range.to, limit],
    );
    return result.rows;
  }

  private transactions(filter: TransactionFilter): Knex.QueryBuilder {
    const query = this.db
      .executor()('payments as p')
      .join('bookings as b', 'b.id', 'p.booking_id')
      .join('showtimes as s', 's.id', 'b.showtime_id')
      .join('theaters as t', 't.id', 's.theater_id');
    for (const condition of transactionConditions(filter)) {
      query.whereRaw(condition.sql, [...condition.bindings] as Knex.RawBinding[]);
    }
    return query;
  }
}
