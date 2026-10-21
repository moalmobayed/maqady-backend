import { Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import type { PageRequest } from '../../common/pagination/types';
import type { HallListFilter, HallRow, HallRowUpdate, HallStatus, NewHallRow } from './types';

const HALL_COLUMNS = [
  'id',
  'theater_id',
  'name',
  'status',
  'row_count',
  'seats_per_row',
  'created_at',
  'updated_at',
] as const;

const BY_NAME = [
  { column: 'name', order: 'asc' },
  { column: 'id', order: 'asc' },
] as const;

/**
 * `halls` (design §6.2). Reads of many halls take every id at once (`whereIn`), so a page or a
 * theater list costs one query here whatever the number of halls.
 */
@Injectable()
export class HallsRepository {
  constructor(private readonly db: TransactionContext) {}

  async insert(row: NewHallRow): Promise<HallRow> {
    const [inserted] = await this.halls().insert(row).returning<HallRow[]>(HALL_COLUMNS);
    if (!inserted) throw new AppError('INTERNAL', 'The hall insert returned no row.');
    return inserted;
  }

  async findById(id: number): Promise<HallRow | undefined> {
    return this.halls().select<HallRow[]>(HALL_COLUMNS).where({ id }).first();
  }

  /** The hall, locked `FOR UPDATE` until the transaction ends: a hall write or a layout save. */
  async findByIdForUpdate(id: number): Promise<HallRow | undefined> {
    return this.halls().select<HallRow[]>(HALL_COLUMNS).where({ id }).forUpdate().first();
  }

  /** The hall, locked `FOR SHARE`: hall writes and layout saves wait until the transaction ends. */
  async findByIdForShare(id: number): Promise<HallRow | undefined> {
    return this.halls().select<HallRow[]>(HALL_COLUMNS).where({ id }).forShare().first();
  }

  async findByIds(ids: readonly number[]): Promise<HallRow[]> {
    if (ids.length === 0) return [];
    return this.halls()
      .select<HallRow[]>(HALL_COLUMNS)
      .whereIn('id', [...ids])
      .orderBy([...BY_NAME]);
  }

  /** Up to `limit + 1` halls of the theater after the cursor, by name then id. */
  async listByTheater(
    theaterId: number,
    filter: HallListFilter,
    page: PageRequest,
  ): Promise<HallRow[]> {
    const query = this.filtered(theaterId, filter)
      .select<HallRow[]>(HALL_COLUMNS)
      .orderBy([...BY_NAME])
      .limit(page.limit + 1);
    if (page.after) {
      query.whereRaw('(name, id) > (?::citext, ?)', [page.after.sortKey, page.after.id]);
    }
    return query;
  }

  async countByTheater(theaterId: number, filter: HallListFilter): Promise<number> {
    const row = await this.filtered(theaterId, filter)
      .count<{ count: number }[]>({ count: 'id' })
      .first();
    return row?.count ?? 0;
  }

  /** The halls of these theaters, optionally only in `statuses`, by theater, name and id. */
  async listByTheaterIds(
    theaterIds: readonly number[],
    statuses?: readonly HallStatus[],
  ): Promise<HallRow[]> {
    if (theaterIds.length === 0) return [];
    const query = this.halls()
      .select<HallRow[]>(HALL_COLUMNS)
      .whereIn('theater_id', [...theaterIds])
      .orderBy([{ column: 'theater_id', order: 'asc' }, ...BY_NAME]);
    if (statuses !== undefined) query.whereIn('status', [...statuses]);
    return query;
  }

  /** Whether the theater has at least one `active` hall (its `active_hall` publish requirement). */
  async hasActiveHall(theaterId: number): Promise<boolean> {
    const row = await this.halls()
      .select('id')
      .where({ theater_id: theaterId, status: 'active' })
      .first<{ id: number } | undefined>();
    return row !== undefined;
  }

  async update(id: number, changes: HallRowUpdate): Promise<HallRow> {
    const [updated] = await this.halls()
      .update(changes)
      .where({ id })
      .returning<HallRow[]>(HALL_COLUMNS);
    if (!updated) throw new AppError('INTERNAL', 'The hall to update is gone.');
    return updated;
  }

  /** Deletes the hall; its rows and seat marks cascade. */
  async deleteById(id: number): Promise<void> {
    await this.halls().where({ id }).delete();
  }

  private halls(): Knex.QueryBuilder {
    return this.db.executor()('halls');
  }

  private filtered(theaterId: number, filter: HallListFilter): Knex.QueryBuilder {
    const query = this.halls().where({ theater_id: theaterId });
    if (filter.status !== undefined) query.where({ status: filter.status });
    return query;
  }
}
