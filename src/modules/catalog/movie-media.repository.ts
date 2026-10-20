import { Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import type {
  MoviePhotoRow,
  MoviePhotoRowUpdate,
  MovieVideoRow,
  MovieVideoRowUpdate,
  NewMoviePhotoRow,
  NewMovieVideoRow,
} from './types';

const PHOTO_COLUMNS = [
  'id',
  'movie_id',
  'image_id',
  'kind',
  'caption',
  'sort_order',
  'created_at',
  'updated_at',
] as const;

const VIDEO_COLUMNS = [
  'id',
  'movie_id',
  'youtube_id',
  'kind',
  'title',
  'duration_seconds',
  'sort_order',
  'created_at',
  'updated_at',
] as const;

const DISPLAY_ORDER = [
  { column: 'movie_id', order: 'asc' },
  { column: 'sort_order', order: 'asc' },
  { column: 'id', order: 'asc' },
] as const;

/**
 * `movie_photos` and `movie_videos` (design §6.2). Each movie's list is kept in display order
 * `0…n-1` by `sort_order`; `setOrder` renumbers a whole list in one statement.
 */
@Injectable()
export class MovieMediaRepository {
  constructor(private readonly db: TransactionContext) {}

  // --- Photos -------------------------------------------------------------------------------

  /** The photos of these movies, by movie then display order, in one query. */
  async photosOf(movieIds: readonly number[]): Promise<MoviePhotoRow[]> {
    if (movieIds.length === 0) return [];
    return this.photos()
      .select<MoviePhotoRow[]>(PHOTO_COLUMNS)
      .whereIn('movie_id', [...movieIds])
      .orderBy([...DISPLAY_ORDER]);
  }

  async findPhotosByIds(ids: readonly number[]): Promise<MoviePhotoRow[]> {
    if (ids.length === 0) return [];
    return this.photos()
      .select<MoviePhotoRow[]>(PHOTO_COLUMNS)
      .whereIn('id', [...ids]);
  }

  async findPhoto(movieId: number, id: number): Promise<MoviePhotoRow | undefined> {
    return this.photos()
      .select<MoviePhotoRow[]>(PHOTO_COLUMNS)
      .where({ id, movie_id: movieId })
      .first();
  }

  async countPhotos(movieId: number): Promise<number> {
    const row = await this.photos()
      .count<{ count: number }[]>({ count: 'id' })
      .where({ movie_id: movieId })
      .first();
    return row?.count ?? 0;
  }

  async insertPhoto(row: NewMoviePhotoRow): Promise<MoviePhotoRow> {
    const [inserted] = await this.photos().insert(row).returning<MoviePhotoRow[]>(PHOTO_COLUMNS);
    if (!inserted) throw new AppError('INTERNAL', 'The new photo was not returned.');
    return inserted;
  }

  async updatePhoto(id: number, changes: MoviePhotoRowUpdate): Promise<void> {
    await this.photos().update(changes).where({ id });
  }

  async deletePhoto(id: number): Promise<void> {
    await this.photos().where({ id }).delete();
  }

  /** The ids of a movie's photos in display order. */
  async photoOrder(movieId: number): Promise<number[]> {
    const rows = await this.photos()
      .select<{ id: number }[]>('id')
      .where({ movie_id: movieId })
      .orderBy([...DISPLAY_ORDER]);
    return rows.map((row) => row.id);
  }

  /** Sets `sort_order` to each photo's index in `orderedIds`, in one statement. */
  async setPhotoOrder(movieId: number, orderedIds: readonly number[]): Promise<void> {
    await this.setOrder('movie_photos', movieId, orderedIds);
  }

  // --- Videos -------------------------------------------------------------------------------

  /** The videos of these movies, by movie then display order, in one query. */
  async videosOf(movieIds: readonly number[]): Promise<MovieVideoRow[]> {
    if (movieIds.length === 0) return [];
    return this.videos()
      .select<MovieVideoRow[]>(VIDEO_COLUMNS)
      .whereIn('movie_id', [...movieIds])
      .orderBy([...DISPLAY_ORDER]);
  }

  async findVideosByIds(ids: readonly number[]): Promise<MovieVideoRow[]> {
    if (ids.length === 0) return [];
    return this.videos()
      .select<MovieVideoRow[]>(VIDEO_COLUMNS)
      .whereIn('id', [...ids]);
  }

  async findVideo(movieId: number, id: number): Promise<MovieVideoRow | undefined> {
    return this.videos()
      .select<MovieVideoRow[]>(VIDEO_COLUMNS)
      .where({ id, movie_id: movieId })
      .first();
  }

  async findVideoByYoutubeId(
    movieId: number,
    youtubeId: string,
  ): Promise<{ id: number } | undefined> {
    return this.videos()
      .select<{ id: number }[]>('id')
      .where({ movie_id: movieId, youtube_id: youtubeId })
      .first();
  }

  async countVideos(movieId: number): Promise<number> {
    const row = await this.videos()
      .count<{ count: number }[]>({ count: 'id' })
      .where({ movie_id: movieId })
      .first();
    return row?.count ?? 0;
  }

  async insertVideo(row: NewMovieVideoRow): Promise<MovieVideoRow> {
    const [inserted] = await this.videos().insert(row).returning<MovieVideoRow[]>(VIDEO_COLUMNS);
    if (!inserted) throw new AppError('INTERNAL', 'The new video was not returned.');
    return inserted;
  }

  async updateVideo(id: number, changes: MovieVideoRowUpdate): Promise<void> {
    await this.videos().update(changes).where({ id });
  }

  async deleteVideo(id: number): Promise<void> {
    await this.videos().where({ id }).delete();
  }

  async videoOrder(movieId: number): Promise<number[]> {
    const rows = await this.videos()
      .select<{ id: number }[]>('id')
      .where({ movie_id: movieId })
      .orderBy([...DISPLAY_ORDER]);
    return rows.map((row) => row.id);
  }

  async setVideoOrder(movieId: number, orderedIds: readonly number[]): Promise<void> {
    await this.setOrder('movie_videos', movieId, orderedIds);
  }

  private photos(): Knex.QueryBuilder {
    return this.db.executor()('movie_photos');
  }

  private videos(): Knex.QueryBuilder {
    return this.db.executor()('movie_videos');
  }

  private async setOrder(
    table: 'movie_photos' | 'movie_videos',
    movieId: number,
    orderedIds: readonly number[],
  ): Promise<void> {
    if (orderedIds.length === 0) return;
    await this.db.executor().raw(
      `UPDATE ?? AS t SET sort_order = v.ord - 1
       FROM unnest(?::bigint[]) WITH ORDINALITY AS v(id, ord)
       WHERE t.id = v.id AND t.movie_id = ? AND t.sort_order <> v.ord - 1`,
      [table, [...orderedIds], movieId],
    );
  }
}
