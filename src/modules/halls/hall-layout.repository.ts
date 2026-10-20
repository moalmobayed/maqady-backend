import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../../common/database/transaction-context';
import type { HallRowRow, HallSeatMarkRow } from './types';

const ROW_COLUMNS = ['hall_id', 'row_index', 'row_label', 'zone'] as const;
const MARK_COLUMNS = ['hall_id', 'row_label', 'seat_number', 'kind'] as const;

/**
 * `hall_rows` and `hall_seat_marks` (design §6.2): a hall's layout beyond its size. Reads take
 * every hall at once; a replace is three statements whatever the size of the layout.
 */
@Injectable()
export class HallLayoutRepository {
  constructor(private readonly db: TransactionContext) {}

  /** The rows of these halls, by hall then front to back. */
  async rowsOf(hallIds: readonly number[]): Promise<HallRowRow[]> {
    if (hallIds.length === 0) return [];
    return this.db
      .executor()('hall_rows')
      .select<HallRowRow[]>(ROW_COLUMNS)
      .whereIn('hall_id', [...hallIds])
      .orderBy([
        { column: 'hall_id', order: 'asc' },
        { column: 'row_index', order: 'asc' },
      ]);
  }

  /** The seat marks of these halls, by hall, row and seat. */
  async marksOf(hallIds: readonly number[]): Promise<HallSeatMarkRow[]> {
    if (hallIds.length === 0) return [];
    return this.db
      .executor()('hall_seat_marks')
      .select<HallSeatMarkRow[]>(MARK_COLUMNS)
      .whereIn('hall_id', [...hallIds])
      .orderBy([
        { column: 'hall_id', order: 'asc' },
        { column: 'row_label', order: 'asc' },
        { column: 'seat_number', order: 'asc' },
      ]);
  }

  /**
   * Replaces the hall's rows and marks with these: one `DELETE` of the rows (the marks cascade),
   * then one multi-row `INSERT` each. Call it in the transaction that holds the hall
   * `FOR UPDATE`.
   */
  async replace(
    hallId: number,
    rows: readonly HallRowRow[],
    marks: readonly HallSeatMarkRow[],
  ): Promise<void> {
    await this.db.executor()('hall_rows').where({ hall_id: hallId }).delete();
    if (rows.length > 0)
      await this.db
        .executor()('hall_rows')
        .insert([...rows]);
    if (marks.length > 0)
      await this.db
        .executor()('hall_seat_marks')
        .insert([...marks]);
  }
}
