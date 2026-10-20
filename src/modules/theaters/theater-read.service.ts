import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import { MediaService } from '../media/media.service';
import { TheaterPhotosRepository } from './theater-photos.repository';
import { TheaterChildren, toTheaterSummary } from './theater-rows';
import { TheatersRepository } from './theaters.repository';
import type { TheaterDetails, TheaterRow, TheaterSummary } from './types';

/**
 * Theaters as other units read them (exported by `TheatersModule`):
 *
 * - U5 and U7 call `lockForShare()` first in their write transactions, so a theater write
 *   (publish, hours, prices) and their hall or showtime write never interleave;
 * - U8 lists and shows `active` theaters with `listActive()`, `findActive()` and
 *   `findActiveByIds()`.
 *
 * Every read of many theaters costs a fixed number of queries: the theaters, then their phones,
 * facilities and photos, and one image query for every cover and photo.
 */
@Injectable()
export class TheaterReadService {
  constructor(
    private readonly theaters: TheatersRepository,
    private readonly photos: TheaterPhotosRepository,
    private readonly media: MediaService,
    private readonly context: TransactionContext,
  ) {}

  /** A theater in any status (U5, U7); null when there is none. */
  async findById(id: number): Promise<TheaterDetails | null> {
    const row = await this.theaters.findById(id);
    if (!row) return null;
    const [details] = await this.detailsOf([row]);
    return details ?? null;
  }

  /**
   * Locks the theater `FOR SHARE` in the open transaction and returns its status and prices;
   * null when there is none. Theater writes (publish, pause, hours, prices, deletion) wait until
   * that transaction ends. Call it before locking any hall or showtime row (design §7.1).
   */
  async lockForShare(id: number): Promise<TheaterSummary | null> {
    if (!this.context.isActive()) {
      throw new AppError('INTERNAL', 'lockForShare() needs an open transaction.');
    }
    const row = await this.theaters.findByIdForShare(id);
    return row ? toTheaterSummary(row) : null;
  }

  /** Every `active` theater, by name (U8: theater list, home page cinemas). */
  async listActive(): Promise<readonly TheaterDetails[]> {
    return this.detailsOf(await this.theaters.listByStatus('active'));
  }

  /** An `active` theater; null for a draft, a paused or a missing one (U8: theater page). */
  async findActive(id: number): Promise<TheaterDetails | null> {
    const [row] = await this.theaters.findByIdsWithStatus([id], 'active');
    if (!row) return null;
    const [details] = await this.detailsOf([row]);
    return details ?? null;
  }

  /** The `active` theaters among `ids`, by id; the others are absent from the map. */
  async findActiveByIds(ids: readonly number[]): Promise<ReadonlyMap<number, TheaterDetails>> {
    const rows = await this.theaters.findByIdsWithStatus([...new Set(ids)], 'active');
    const details = await this.detailsOf(rows);
    return new Map(details.map((theater) => [theater.id, theater]));
  }

  /** The details of these theater rows, in their order, in four queries whatever their number. */
  async detailsOf(rows: readonly TheaterRow[]): Promise<TheaterDetails[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const [phones, facilities, photos] = await Promise.all([
      this.theaters.phonesOf(ids),
      this.theaters.facilitiesOf(ids),
      this.photos.photosOf(ids),
    ]);
    const imageIds = [
      ...rows.flatMap((row) => (row.cover_image_id === null ? [] : [row.cover_image_id])),
      ...photos.map((photo) => photo.image_id),
    ];
    const images = await this.media.findByIds(imageIds);
    const children = new TheaterChildren(phones, facilities, photos, images);
    return rows.map((row) => children.details(row));
  }
}
