import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import type { ImageRow, NewImageRow } from './types';

const IMAGE_COLUMNS = [
  'id',
  'kind',
  'storage_prefix',
  'variants',
  'source_width',
  'source_height',
  'created_by_staff_id',
  'created_at',
] as const;

/**
 * `images` (design §6.2). Every statement runs on the current transaction when one is open
 * (`TransactionContext`), so a row commits or rolls back with the write that links it.
 */
@Injectable()
export class ImagesRepository {
  constructor(private readonly db: TransactionContext) {}

  async insert(row: NewImageRow): Promise<ImageRow> {
    const [inserted] = await this.db
      .executor()('images')
      .insert({ ...row, variants: JSON.stringify(row.variants) })
      .returning<ImageRow[]>(IMAGE_COLUMNS);
    if (!inserted) throw new AppError('INTERNAL', 'INSERT … RETURNING returned no row.');
    return inserted;
  }

  /** The rows with these ids, in one query; ids without a row are left out. */
  async findByIds(ids: readonly number[]): Promise<ImageRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .executor()('images')
      .select<ImageRow[]>(IMAGE_COLUMNS)
      .whereIn('id', [...ids]);
  }

  /** Deletes the rows with these ids in one statement and returns them, for their files. */
  async deleteByIds(ids: readonly number[]): Promise<ImageRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .executor()('images')
      .whereIn('id', [...ids])
      .delete()
      .returning<ImageRow[]>(IMAGE_COLUMNS);
  }

  /** Which of these storage prefixes have a row (served by `uq_images_storage_prefix`). */
  async existingPrefixes(prefixes: readonly string[]): Promise<Set<string>> {
    if (prefixes.length === 0) return new Set();
    const rows = await this.db
      .executor()('images')
      .select<{ storage_prefix: string }[]>('storage_prefix')
      .whereIn('storage_prefix', [...prefixes]);
    return new Set(rows.map((row) => row.storage_prefix));
  }
}
