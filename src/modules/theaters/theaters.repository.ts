import { Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import type { PageRequest } from '../../common/pagination/types';
import type {
  Facility,
  NewTheaterPhoneRow,
  NewTheaterRow,
  TheaterFacilityRow,
  TheaterListFilter,
  TheaterPhoneRow,
  TheaterRow,
  TheaterRowUpdate,
  TheaterStatus,
} from './types';

const THEATER_COLUMNS = [
  'id',
  'name',
  'status',
  'address',
  'district',
  'city',
  'latitude',
  'longitude',
  'transit_info',
  'parking_info',
  'email',
  'show_contacts_public',
  'cover_image_id',
  'default_price_front',
  'default_price_middle',
  'default_price_back',
  'currency',
  'created_at',
  'updated_at',
] as const;

const PHONE_COLUMNS = ['theater_id', 'label', 'number', 'sort_order'] as const;

/**
 * `theaters`, `theater_phones` and `theater_facilities` (design §6.2). Reads of several theaters'
 * children take every id at once (`whereIn`), so a page of theaters costs a fixed number of
 * queries.
 */
@Injectable()
export class TheatersRepository {
  constructor(private readonly db: TransactionContext) {}

  async insert(row: NewTheaterRow): Promise<TheaterRow> {
    const [inserted] = await this.theaters().insert(row).returning<TheaterRow[]>(THEATER_COLUMNS);
    if (!inserted) throw new AppError('INTERNAL', 'The theater insert returned no row.');
    return inserted;
  }

  async findById(id: number): Promise<TheaterRow | undefined> {
    return this.theaters().select<TheaterRow[]>(THEATER_COLUMNS).where({ id }).first();
  }

  async findByIds(ids: readonly number[]): Promise<TheaterRow[]> {
    if (ids.length === 0) return [];
    return this.theaters()
      .select<TheaterRow[]>(THEATER_COLUMNS)
      .whereIn('id', [...ids]);
  }

  /**
   * The theater, locked against every other theater write and against U5's and U7's
   * `FOR SHARE` until the transaction ends. `FOR NO KEY UPDATE`, so other transactions' foreign
   * key checks (a new hall or showtime row) are not blocked.
   */
  async findByIdForWrite(id: number): Promise<TheaterRow | undefined> {
    return this.theaters()
      .select<TheaterRow[]>(THEATER_COLUMNS)
      .where({ id })
      .forNoKeyUpdate()
      .first();
  }

  /** The theater, locked `FOR UPDATE` for its deletion, which its foreign keys must wait for. */
  async findByIdForDelete(id: number): Promise<TheaterRow | undefined> {
    return this.theaters().select<TheaterRow[]>(THEATER_COLUMNS).where({ id }).forUpdate().first();
  }

  /** The theater, locked `FOR SHARE`: theater writes wait until the transaction ends. */
  async findByIdForShare(id: number): Promise<TheaterRow | undefined> {
    return this.theaters().select<TheaterRow[]>(THEATER_COLUMNS).where({ id }).forShare().first();
  }

  /** Up to `limit + 1` theaters after the cursor, by name then id. */
  async list(filter: TheaterListFilter, page: PageRequest): Promise<TheaterRow[]> {
    const query = this.filtered(filter)
      .select<TheaterRow[]>(THEATER_COLUMNS)
      .orderBy([
        { column: 'name', order: 'asc' },
        { column: 'id', order: 'asc' },
      ])
      .limit(page.limit + 1);
    if (page.after) {
      query.whereRaw('(name, id) > (?::citext, ?)', [page.after.sortKey, page.after.id]);
    }
    return query;
  }

  async count(filter: TheaterListFilter): Promise<number> {
    const row = await this.filtered(filter).count<{ count: number }[]>({ count: 'id' }).first();
    return row?.count ?? 0;
  }

  /** Every theater in `status`, by name then id. */
  async listByStatus(status: TheaterStatus): Promise<TheaterRow[]> {
    return this.theaters()
      .select<TheaterRow[]>(THEATER_COLUMNS)
      .where({ status })
      .orderBy([
        { column: 'name', order: 'asc' },
        { column: 'id', order: 'asc' },
      ]);
  }

  /** The theaters in `status` among `ids`. */
  async findByIdsWithStatus(ids: readonly number[], status: TheaterStatus): Promise<TheaterRow[]> {
    if (ids.length === 0) return [];
    return this.theaters()
      .select<TheaterRow[]>(THEATER_COLUMNS)
      .whereIn('id', [...ids])
      .where({ status });
  }

  async update(id: number, changes: TheaterRowUpdate): Promise<TheaterRow> {
    const [updated] = await this.theaters()
      .update(changes)
      .where({ id })
      .returning<TheaterRow[]>(THEATER_COLUMNS);
    if (!updated) throw new AppError('INTERNAL', 'The theater to update is gone.');
    return updated;
  }

  /** Deletes the theater; its phones, facilities, photos, hours and special dates cascade. */
  async deleteById(id: number): Promise<void> {
    await this.theaters().where({ id }).delete();
  }

  /** Replaces the theater's phones with these, in order. */
  async replacePhones(theaterId: number, phones: readonly NewTheaterPhoneRow[]): Promise<void> {
    await this.db.executor()('theater_phones').where({ theater_id: theaterId }).delete();
    if (phones.length > 0)
      await this.db
        .executor()('theater_phones')
        .insert([...phones]);
  }

  /** The phones of these theaters, by theater then order. */
  async phonesOf(theaterIds: readonly number[]): Promise<TheaterPhoneRow[]> {
    if (theaterIds.length === 0) return [];
    return this.db
      .executor()('theater_phones')
      .select<TheaterPhoneRow[]>(PHONE_COLUMNS)
      .whereIn('theater_id', [...theaterIds])
      .orderBy([
        { column: 'theater_id', order: 'asc' },
        { column: 'sort_order', order: 'asc' },
      ]);
  }

  /** Replaces the theater's facilities with these. */
  async replaceFacilities(theaterId: number, facilities: readonly Facility[]): Promise<void> {
    await this.db.executor()('theater_facilities').where({ theater_id: theaterId }).delete();
    if (facilities.length > 0) {
      await this.db
        .executor()('theater_facilities')
        .insert(facilities.map((facility) => ({ theater_id: theaterId, facility })));
    }
  }

  /** The facilities of these theaters. */
  async facilitiesOf(theaterIds: readonly number[]): Promise<TheaterFacilityRow[]> {
    if (theaterIds.length === 0) return [];
    return this.db
      .executor()('theater_facilities')
      .select<TheaterFacilityRow[]>('theater_id', 'facility')
      .whereIn('theater_id', [...theaterIds]);
  }

  private theaters(): Knex.QueryBuilder {
    return this.db.executor()('theaters');
  }

  private filtered(filter: TheaterListFilter): Knex.QueryBuilder {
    const query = this.theaters();
    if (filter.status !== undefined) query.where({ status: filter.status });
    return query;
  }
}
