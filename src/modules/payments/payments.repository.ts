import { Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import type {
  BookingCountRow,
  ChargeResultColumns,
  DueCursor,
  FinishedChargeRow,
  InstantRange,
  LedgerRow,
  MoneyMovedRow,
  NewCounterChargeRow,
  NewPaymentRow,
  NewRefundRow,
  PaymentKind,
  PaymentRow,
  RefundPurpose,
} from './types';

const PAYMENT_COLUMNS = [
  'id',
  'booking_id',
  'kind',
  'purpose',
  'method',
  'status',
  'amount',
  'currency',
  'refund_of_payment_id',
  'provider_idempotency_key',
  'provider_reference',
  'card_brand',
  'card_last4',
  'wallet_type',
  'settles_at',
  'completed_at',
  'created_at',
  'updated_at',
] as const;

const COLUMN_LIST = PAYMENT_COLUMNS.join(', ');

/** The ledger's columns (U14): every payment column, the counter and payout ones included. */
const LEDGER_COLUMNS = [
  ...PAYMENT_COLUMNS,
  'collected_by_staff_id',
  'paid_out_at',
  'paid_out_by_staff_id',
] as const;

/** A charge's refunds so far, through `idx_payments_refund_of_payment_id`; 0 for a refund row. */
const REFUNDED_AMOUNT_SQL = `COALESCE((SELECT SUM(r.amount) FROM payments AS r
  WHERE r.refund_of_payment_id = p.id), 0)::int AS refunded_amount`;

/**
 * `payments` (design §6.2). Every method runs on the current executor, so it joins the request
 * transaction; reads of many bookings are one query each. A payment row is only ever written by
 * a transaction that holds its booking `FOR UPDATE` (design §7.1), which is what makes a count
 * or a "processing" check read under that lock true until the transaction ends.
 */
@Injectable()
export class PaymentsRepository {
  constructor(private readonly db: TransactionContext) {}

  async insert(row: NewPaymentRow): Promise<PaymentRow> {
    const [inserted] = await this.payments().insert(row).returning<PaymentRow[]>(PAYMENT_COLUMNS);
    if (!inserted) throw new AppError('INTERNAL', 'The payment insert returned no row.');
    return inserted;
  }

  /** A counter charge (U13), already `succeeded`. */
  async insertCounterCharge(row: NewCounterChargeRow): Promise<PaymentRow> {
    const [inserted] = await this.payments().insert(row).returning<PaymentRow[]>(PAYMENT_COLUMNS);
    if (!inserted) throw new AppError('INTERNAL', 'The payment insert returned no row.');
    return inserted;
  }

  /** Records a provider result on a charge. */
  async recordResult(id: number, columns: ChargeResultColumns): Promise<PaymentRow> {
    const [updated] = await this.payments()
      .where({ id })
      .update(columns)
      .returning<PaymentRow[]>(PAYMENT_COLUMNS);
    if (!updated) throw new AppError('INTERNAL', 'The payment update returned no row.');
    return updated;
  }

  /** How many rows of one kind and purpose a booking has (the `<n>` of our provider keys). */
  async countOf(bookingId: number, kind: PaymentKind): Promise<number> {
    const row = await this.payments()
      .where({ booking_id: bookingId, kind })
      .count<{ count: number }[]>({ count: '*' })
      .first();
    return Number(row?.count ?? 0);
  }

  /** The latest sale charge of each of these bookings (newest `created_at`, then id). */
  async latestSalesOf(bookingIds: readonly number[]): Promise<PaymentRow[]> {
    if (bookingIds.length === 0) return [];
    const result = await this.db.executor().raw<{ rows: PaymentRow[] }>(
      `SELECT DISTINCT ON (booking_id) ${COLUMN_LIST} FROM payments
       WHERE booking_id = ANY(?::bigint[]) AND kind = 'charge' AND purpose = 'sale'
       ORDER BY booking_id, created_at DESC, id DESC`,
      [[...new Set(bookingIds)]],
    );
    return result.rows;
  }

  /** The bookings among these that have a sale charge still processing. */
  async processingSaleBookingIds(bookingIds: readonly number[]): Promise<number[]> {
    if (bookingIds.length === 0) return [];
    const rows = await this.payments()
      .distinct<{ booking_id: number }[]>('booking_id')
      .whereIn('booking_id', [...new Set(bookingIds)])
      .where({ kind: 'charge', purpose: 'sale', status: 'processing' })
      .orderBy('booking_id');
    return rows.map((row) => row.booking_id);
  }

  /**
   * Charges still processing whose result is due at `now`, oldest `settles_at` first, after
   * `after` when given (keyset pagination on `(settles_at, id)`).
   */
  async due(now: Date, limit: number, after?: DueCursor): Promise<PaymentRow[]> {
    const query = this.payments()
      .select<PaymentRow[]>(PAYMENT_COLUMNS)
      .where({ status: 'processing' })
      .andWhere('settles_at', '<=', now);
    if (after) {
      query
        .andWhere('settles_at', '>=', after.settlesAt)
        .andWhereRaw('(settles_at, id) > (?, ?)', [after.settlesAt, after.paymentId]);
    }
    return query
      .orderBy([
        { column: 'settles_at', order: 'asc' },
        { column: 'id', order: 'asc' },
      ])
      .limit(limit);
  }

  /**
   * Gives these charges their final status in one statement, only where they are still
   * `processing`, and returns the rows it changed: of two settlements racing for a charge, only
   * one gets it back (design §7.5 step 1).
   */
  async finishProcessing(rows: readonly FinishedChargeRow[], now: Date): Promise<PaymentRow[]> {
    if (rows.length === 0) return [];
    const result = await this.db.executor().raw<{ rows: PaymentRow[] }>(
      `UPDATE payments AS p
       SET status = f.status, completed_at = ?, updated_at = ?
       FROM unnest(?::bigint[], ?::text[]) AS f(id, status)
       WHERE p.id = f.id AND p.status = 'processing'
       RETURNING ${PAYMENT_COLUMNS.map((column) => `p.${column}`).join(', ')}`,
      [now, now, rows.map((row) => row.id), rows.map((row) => row.status)],
    );
    return result.rows;
  }

  /** How many sale charges or refunds each booking has, for a batch of provider keys. */
  async countsOf(bookingIds: readonly number[], kind: PaymentKind): Promise<BookingCountRow[]> {
    if (bookingIds.length === 0) return [];
    return this.payments()
      .select('booking_id')
      .count<BookingCountRow[]>({ count: '*' })
      .whereIn('booking_id', [...new Set(bookingIds)])
      .where({ kind })
      .groupBy('booking_id');
  }

  /** Several rows in one multi-row insert, returned in input order. */
  async insertMany(rows: readonly NewPaymentRow[]): Promise<PaymentRow[]> {
    if (rows.length === 0) return [];
    const inserted = await this.payments()
      .insert([...rows])
      .returning<PaymentRow[]>(PAYMENT_COLUMNS);
    return rows.map((row) => {
      const match = inserted.find(
        (candidate) => candidate.provider_idempotency_key === row.provider_idempotency_key,
      );
      if (!match) throw new AppError('INTERNAL', 'A payment insert returned no row.');
      return match;
    });
  }

  /**
   * Every payment and refund of these bookings, each charge with the sum of its refunds so far,
   * by booking, then oldest first (`idx_payments_booking_id_created_at`). Under the booking's
   * `FOR UPDATE` lock the remaining amounts stay true until the transaction ends.
   */
  async ledgerOf(bookingIds: readonly number[]): Promise<LedgerRow[]> {
    if (bookingIds.length === 0) return [];
    const result = await this.db.executor().raw<{ rows: LedgerRow[] }>(
      `SELECT ${LEDGER_COLUMNS.map((column) => `p.${column}`).join(', ')}, ${REFUNDED_AMOUNT_SQL}
       FROM payments AS p
       WHERE p.booking_id = ANY(?::bigint[])
       ORDER BY p.booking_id, p.created_at, p.id`,
      [[...new Set(bookingIds)]],
    );
    return result.rows;
  }

  /** One payment row with the ledger columns, or undefined. */
  async findLedgerEntry(id: number): Promise<LedgerRow | undefined> {
    const result = await this.db.executor().raw<{ rows: LedgerRow[] }>(
      `SELECT ${LEDGER_COLUMNS.map((column) => `p.${column}`).join(', ')}, ${REFUNDED_AMOUNT_SQL}
       FROM payments AS p WHERE p.id = ?`,
      [id],
    );
    return result.rows[0];
  }

  /**
   * Refunds in one multi-row insert (U14), returned in input order. A batch refunds each charge
   * at most once, so `refund_of_payment_id` names each returned row.
   */
  async insertRefunds(rows: readonly NewRefundRow[]): Promise<LedgerRow[]> {
    if (rows.length === 0) return [];
    const inserted = await this.payments()
      .insert([...rows])
      .returning<Omit<LedgerRow, 'refunded_amount'>[]>(LEDGER_COLUMNS);
    return rows.map((row) => {
      const match = inserted.find(
        (candidate) => candidate.refund_of_payment_id === row.refund_of_payment_id,
      );
      if (!match) throw new AppError('INTERNAL', 'A refund insert returned no row.');
      return { ...match, refunded_amount: 0 };
    });
  }

  /**
   * Pays out a pending counter refund (design §7.7): `succeeded` now, by this staff member. Only a
   * refund still `pending` changes; returns it, or undefined when nothing changed.
   */
  async markPaidOut(id: number, staffUserId: number, now: Date): Promise<LedgerRow | undefined> {
    const [updated] = await this.payments()
      .where({ id, kind: 'refund', status: 'pending' })
      .update({
        status: 'succeeded',
        completed_at: now,
        paid_out_at: now,
        paid_out_by_staff_id: staffUserId,
        updated_at: now,
      })
      .returning<Omit<LedgerRow, 'refunded_amount'>[]>(LEDGER_COLUMNS);
    return updated ? { ...updated, refunded_amount: 0 } : undefined;
  }

  /**
   * The money that moved in `[from, to)` (PRD "Collected"): succeeded charges minus succeeded
   * refunds by `completed_at` (a counter refund once paid out), and the declined charges, in one
   * query through `idx_payments_completed_at`. Every row is EGP (`chk_payments_currency`).
   */
  async moneyMovedBetween(range: InstantRange): Promise<MoneyMovedRow> {
    const row = await this.payments()
      .select<MoneyMovedRow[]>(
        this.db
          .executor()
          .raw(
            `COALESCE(SUM(CASE WHEN status <> 'succeeded' THEN 0 WHEN kind = 'charge' THEN amount ELSE -amount END), 0)::int AS collected`,
          ),
        this.db
          .executor()
          .raw(`COUNT(*) FILTER (WHERE kind = 'charge' AND status = 'declined')::int AS declined`),
      )
      .where('completed_at', '>=', range.from)
      .andWhere('completed_at', '<', range.to)
      .whereIn('status', ['succeeded', 'declined'])
      .first();
    return { collected: row?.collected ?? 0, declined: row?.declined ?? 0 };
  }

  /** The sum of these bookings' refunds of one purpose, in any status (piastres). */
  async refundTotalOf(bookingIds: readonly number[], purpose: RefundPurpose): Promise<number> {
    if (bookingIds.length === 0) return 0;
    const row = await this.payments()
      .sum<{ total: number | null }[]>({ total: 'amount' })
      .whereIn('booking_id', [...new Set(bookingIds)])
      .where({ kind: 'refund', purpose })
      .first();
    return Number(row?.total ?? 0);
  }

  private payments(): Knex.QueryBuilder {
    return this.db.executor()('payments');
  }
}
