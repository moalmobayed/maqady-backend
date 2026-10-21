import { Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import type {
  BookingCountRow,
  ChargeResultColumns,
  FinishedChargeRow,
  NewPaymentRow,
  PaymentKind,
  PaymentRow,
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

  /** Charges still processing whose result is due at `now`, oldest `settles_at` first. */
  async due(now: Date, limit: number): Promise<PaymentRow[]> {
    return this.payments()
      .select<PaymentRow[]>(PAYMENT_COLUMNS)
      .where({ status: 'processing' })
      .andWhere('settles_at', '<=', now)
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

  private payments(): Knex.QueryBuilder {
    return this.db.executor()('payments');
  }
}
