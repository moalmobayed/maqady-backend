import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import type { CalendarDate } from '../../common/time/types';
import type {
  NewSpecialDateRow,
  SpecialDateRow,
  SpecialDateRowUpdate,
  TheaterHoursRow,
} from './types';

const HOURS_COLUMNS = [
  'theater_id',
  'weekday',
  'is_closed',
  'opens_minute',
  'closes_minute',
] as const;

const SPECIAL_DATE_COLUMNS = [
  'id',
  'theater_id',
  'cinema_date',
  'label',
  'is_closed',
  'opens_minute',
  'closes_minute',
  'created_at',
  'updated_at',
] as const;

/** `theater_hours` and `theater_special_dates` (design §6.2, §8). */
@Injectable()
export class TheaterHoursRepository {
  constructor(private readonly db: TransactionContext) {}

  /** Writes the weekly rows given, in one statement: inserted, or replacing the weekday's row. */
  async upsertWeekly(rows: readonly TheaterHoursRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .executor()('theater_hours')
      .insert([...rows])
      .onConflict(['theater_id', 'weekday'])
      .merge(['is_closed', 'opens_minute', 'closes_minute']);
  }

  /** The weekly hours of these theaters, by theater then weekday. */
  async weeklyOf(theaterIds: readonly number[]): Promise<TheaterHoursRow[]> {
    if (theaterIds.length === 0) return [];
    return this.db
      .executor()('theater_hours')
      .select<TheaterHoursRow[]>(HOURS_COLUMNS)
      .whereIn('theater_id', [...theaterIds])
      .orderBy([
        { column: 'theater_id', order: 'asc' },
        { column: 'weekday', order: 'asc' },
      ]);
  }

  /**
   * The special dates of these theaters from `from` to `to` (both included; no upper bound when
   * `to` is null), by theater then date.
   */
  async specialDatesBetween(
    theaterIds: readonly number[],
    from: CalendarDate,
    to: CalendarDate | null,
  ): Promise<SpecialDateRow[]> {
    if (theaterIds.length === 0) return [];
    const query = this.db
      .executor()('theater_special_dates')
      .select<SpecialDateRow[]>(SPECIAL_DATE_COLUMNS)
      .whereIn('theater_id', [...theaterIds])
      .where('cinema_date', '>=', from)
      .orderBy([
        { column: 'theater_id', order: 'asc' },
        { column: 'cinema_date', order: 'asc' },
      ]);
    if (to !== null) query.where('cinema_date', '<=', to);
    return query;
  }

  async insertSpecialDate(row: NewSpecialDateRow): Promise<SpecialDateRow> {
    const [inserted] = await this.db
      .executor()('theater_special_dates')
      .insert(row)
      .returning<SpecialDateRow[]>(SPECIAL_DATE_COLUMNS);
    if (!inserted) throw new AppError('INTERNAL', 'The special date insert returned no row.');
    return inserted;
  }

  /** The theater's special date with this id; undefined for another theater's. */
  async findSpecialDate(theaterId: number, id: number): Promise<SpecialDateRow | undefined> {
    return this.db
      .executor()('theater_special_dates')
      .select<SpecialDateRow[]>(SPECIAL_DATE_COLUMNS)
      .where({ id, theater_id: theaterId })
      .first();
  }

  async updateSpecialDate(id: number, changes: SpecialDateRowUpdate): Promise<SpecialDateRow> {
    const [updated] = await this.db
      .executor()('theater_special_dates')
      .update(changes)
      .where({ id })
      .returning<SpecialDateRow[]>(SPECIAL_DATE_COLUMNS);
    if (!updated) throw new AppError('INTERNAL', 'The special date to update is gone.');
    return updated;
  }

  async deleteSpecialDate(id: number): Promise<void> {
    await this.db.executor()('theater_special_dates').where({ id }).delete();
  }
}
