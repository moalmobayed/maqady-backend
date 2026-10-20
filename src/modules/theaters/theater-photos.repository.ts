import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import type { NewTheaterPhotoRow, TheaterPhotoRow } from './types';

const PHOTO_COLUMNS = [
  'id',
  'theater_id',
  'image_id',
  'caption',
  'sort_order',
  'created_at',
  'updated_at',
] as const;

/** `theater_photos`, a theater's gallery (design §6.2). */
@Injectable()
export class TheaterPhotosRepository {
  constructor(private readonly db: TransactionContext) {}

  /** The gallery photos of these theaters, by theater then gallery order. */
  async photosOf(theaterIds: readonly number[]): Promise<TheaterPhotoRow[]> {
    if (theaterIds.length === 0) return [];
    return this.db
      .executor()('theater_photos')
      .select<TheaterPhotoRow[]>(PHOTO_COLUMNS)
      .whereIn('theater_id', [...theaterIds])
      .orderBy([
        { column: 'theater_id', order: 'asc' },
        { column: 'sort_order', order: 'asc' },
        { column: 'id', order: 'asc' },
      ]);
  }

  async insert(row: NewTheaterPhotoRow): Promise<TheaterPhotoRow> {
    const [inserted] = await this.db
      .executor()('theater_photos')
      .insert(row)
      .returning<TheaterPhotoRow[]>(PHOTO_COLUMNS);
    if (!inserted) throw new AppError('INTERNAL', 'The photo insert returned no row.');
    return inserted;
  }

  /** The theater's photo with this id; undefined for another theater's. */
  async findPhoto(theaterId: number, id: number): Promise<TheaterPhotoRow | undefined> {
    return this.db
      .executor()('theater_photos')
      .select<TheaterPhotoRow[]>(PHOTO_COLUMNS)
      .where({ id, theater_id: theaterId })
      .first();
  }

  async updateCaption(id: number, caption: string | null, updatedAt: Date): Promise<void> {
    await this.db
      .executor()('theater_photos')
      .update({ caption, updated_at: updatedAt })
      .where({ id });
  }

  /**
   * Gives the theater's photos the order of `orderedIds` (`sort_order` 0, 1, …), in one
   * statement; rows already in place are not touched.
   */
  async reorder(theaterId: number, orderedIds: readonly number[], updatedAt: Date): Promise<void> {
    if (orderedIds.length === 0) return;
    await this.db.executor().raw(
      `UPDATE theater_photos AS p
          SET sort_order = o.position - 1, updated_at = ?
         FROM unnest(?::bigint[]) WITH ORDINALITY AS o(id, position)
        WHERE p.id = o.id AND p.theater_id = ? AND p.sort_order <> o.position - 1`,
      [updatedAt, [...orderedIds], theaterId],
    );
  }

  async delete(id: number): Promise<void> {
    await this.db.executor()('theater_photos').where({ id }).delete();
  }
}
