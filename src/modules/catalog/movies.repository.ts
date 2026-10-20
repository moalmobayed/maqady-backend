import { Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import type { PageRequest } from '../../common/pagination/types';
import { PUBLIC_MOVIE_STATUSES } from './enums';
import { containsPattern } from './movie-rules';
import type {
  AdminMovieListFilter,
  GenreCountRow,
  MovieCountsRow,
  MovieRow,
  MovieRowUpdate,
  MovieStatus,
  NewMovieRow,
  PublicMovieCountFilter,
  PublicMovieFilter,
  PublicStatusCountRow,
  SimilarMovieRow,
  StatusCountRow,
} from './types';

const MOVIE_COLUMNS = [
  'id',
  'title',
  'status',
  'synopsis',
  'runtime_minutes',
  'release_date',
  'age_rating',
  'language',
  'country',
  'production_company',
  'budget_label',
  'filming_locations',
  'poster_image_id',
  'backdrop_photo_id',
  'hero_video_id',
  'featured_position',
  'updated_by_staff_id',
  'created_at',
  'updated_at',
] as const;

const M_COLUMNS = MOVIE_COLUMNS.map((column) => `m.${column}`);

/** A title, or a credited person's name, contains the search (served by the trigram indexes). */
const TITLE_OR_CAST_SQL = `(m.title ILIKE ? OR EXISTS (
  SELECT 1 FROM movie_credits sc JOIN people sp ON sp.id = sc.person_id
  WHERE sc.movie_id = m.id AND sp.full_name ILIKE ?))`;

/**
 * `movies` (design §6.2): the admin list and editor, and the public reads U8 builds on. Row
 * locks follow the catalog's lock order (spec "Decisions"): movies in ascending id, then people.
 */
@Injectable()
export class MoviesRepository {
  constructor(private readonly db: TransactionContext) {}

  async insert(row: NewMovieRow): Promise<MovieRow> {
    const [inserted] = await this.movies().insert(row).returning<MovieRow[]>(MOVIE_COLUMNS);
    if (!inserted) throw new AppError('INTERNAL', 'The new movie was not returned.');
    return inserted;
  }

  async findById(id: number): Promise<MovieRow | undefined> {
    return this.movies().select<MovieRow[]>(MOVIE_COLUMNS).where({ id }).first();
  }

  /**
   * The movie, locked until the transaction ends. `FOR NO KEY UPDATE`: it waits for U7's
   * `FOR SHARE` scheduling lock (and makes it wait), but not for foreign-key checks of rows that
   * point at the movie, so adding a credit or a photo never deadlocks with an edit.
   */
  async findByIdForUpdate(id: number): Promise<MovieRow | undefined> {
    return this.movies().select<MovieRow[]>(MOVIE_COLUMNS).where({ id }).forNoKeyUpdate().first();
  }

  /** The movie, locked `FOR UPDATE` for its deletion: nothing may point at it meanwhile. */
  async findByIdForDelete(id: number): Promise<MovieRow | undefined> {
    return this.movies().select<MovieRow[]>(MOVIE_COLUMNS).where({ id }).forUpdate().first();
  }

  /** The movie, locked `FOR SHARE`: a status change waits until the transaction ends (U7). */
  async findByIdForShare(id: number): Promise<MovieRow | undefined> {
    return this.movies().select<MovieRow[]>(MOVIE_COLUMNS).where({ id }).forShare().first();
  }

  /** These movies, locked `FOR NO KEY UPDATE` in ascending id (the lock order). */
  async findByIdsForUpdate(ids: readonly number[]): Promise<MovieRow[]> {
    if (ids.length === 0) return [];
    return this.movies()
      .select<MovieRow[]>(MOVIE_COLUMNS)
      .whereIn('id', [...ids])
      .orderBy('id')
      .forNoKeyUpdate();
  }

  async findByIds(ids: readonly number[]): Promise<MovieRow[]> {
    if (ids.length === 0) return [];
    return this.movies()
      .select<MovieRow[]>(MOVIE_COLUMNS)
      .whereIn('id', [...ids])
      .orderBy('id');
  }

  async update(id: number, changes: MovieRowUpdate): Promise<MovieRow> {
    const [updated] = await this.movies()
      .update(changes)
      .where({ id })
      .returning<MovieRow[]>(MOVIE_COLUMNS);
    if (!updated) throw new AppError('INTERNAL', 'The movie to update is gone.');
    return updated;
  }

  /** "Last edited by" for movies whose media or credits changed. */
  async touch(ids: readonly number[], at: Date, staffId: number): Promise<void> {
    if (ids.length === 0) return;
    await this.movies()
      .update({ updated_at: at, updated_by_staff_id: staffId })
      .whereIn('id', [...ids]);
  }

  /** Archives these movies and frees their carousel positions, in one statement. */
  async archive(ids: readonly number[], at: Date, staffId: number): Promise<void> {
    if (ids.length === 0) return;
    await this.movies()
      .update({
        status: 'archived' satisfies MovieStatus,
        featured_position: null,
        updated_at: at,
        updated_by_staff_id: staffId,
      })
      .whereIn('id', [...ids]);
  }

  async deleteById(id: number): Promise<void> {
    await this.movies().where({ id }).delete();
  }

  /** The movie holding a carousel position, if any. */
  async findByFeaturedPosition(position: number): Promise<{ id: number } | undefined> {
    return this.movies()
      .select<{ id: number }[]>('id')
      .where({ featured_position: position })
      .first();
  }

  // --- Admin list ---------------------------------------------------------------------------

  /** Up to `limit + 1` movies after the cursor, newest first. */
  async adminList(filter: AdminMovieListFilter, page: PageRequest): Promise<MovieRow[]> {
    const query = this.adminFiltered(filter)
      .select<MovieRow[]>(M_COLUMNS)
      .orderBy([
        { column: 'm.created_at', order: 'desc' },
        { column: 'm.id', order: 'desc' },
      ])
      .limit(page.limit + 1);
    if (page.after) {
      query.whereRaw('(m.created_at, m.id) < (?::timestamptz, ?)', [
        page.after.sortKey,
        page.after.id,
      ]);
    }
    return query;
  }

  async adminCount(filter: AdminMovieListFilter): Promise<number> {
    const row = await this.adminFiltered(filter)
      .count<{ count: number }[]>({ count: 'm.id' })
      .first();
    return row?.count ?? 0;
  }

  /** How many movies have each status, with the same search (`status` filter ignored). */
  async adminStatusCounts(q: string | undefined): Promise<StatusCountRow[]> {
    return this.adminFiltered(q === undefined ? {} : { q })
      .select<StatusCountRow[]>('m.status', this.db.executor().raw('count(*)::int AS count'))
      .groupBy('m.status');
  }

  /** Photo, video and credit counts of these movies, in one query. */
  async countsOf(ids: readonly number[]): Promise<MovieCountsRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .executor()('movies as m')
      .select<MovieCountsRow[]>(
        'm.id',
        this.db
          .executor()
          .raw('(SELECT count(*) FROM movie_photos p WHERE p.movie_id = m.id)::int AS photo_count'),
        this.db
          .executor()
          .raw('(SELECT count(*) FROM movie_videos v WHERE v.movie_id = m.id)::int AS video_count'),
        this.db
          .executor()
          .raw(
            '(SELECT count(*) FROM movie_credits c WHERE c.movie_id = m.id)::int AS credit_count',
          ),
      )
      .whereIn('m.id', [...ids]);
  }

  // --- Public reads (U8) --------------------------------------------------------------------

  /**
   * Up to `limit + 1` public movies after the cursor: Now showing newest release first, Coming
   * soon soonest first (PRD C2), ties by id the same way.
   */
  async publicList(filter: PublicMovieFilter, page: PageRequest): Promise<MovieRow[]> {
    const descending = filter.status === 'now_showing';
    const order = descending ? 'desc' : 'asc';
    const query = this.publicFiltered(this.db.executor()('movies as m'), filter)
      .select<MovieRow[]>(M_COLUMNS)
      .orderBy([
        { column: 'm.release_date', order },
        { column: 'm.id', order },
      ])
      .limit(page.limit + 1);
    if (page.after) {
      query.whereRaw(`(m.release_date, m.id) ${descending ? '<' : '>'} (?::date, ?)`, [
        page.after.sortKey,
        page.after.id,
      ]);
    }
    return query;
  }

  async publicCount(filter: PublicMovieCountFilter): Promise<number> {
    const row = await this.publicFiltered(this.db.executor()('movies as m'), filter)
      .count<{ count: number }[]>({ count: 'm.id' })
      .first();
    return row?.count ?? 0;
  }

  /** Public movies per status with these filters (the Movies page tabs). */
  async publicCountsByStatus(filter: PublicMovieCountFilter): Promise<PublicStatusCountRow[]> {
    return this.publicFiltered(this.db.executor()('movies as m'), filter)
      .select<PublicStatusCountRow[]>('m.status', this.db.executor().raw('count(*)::int AS count'))
      .groupBy('m.status');
  }

  /** Public movies per genre with these filters (genre counts). */
  async publicCountsByGenre(filter: PublicMovieCountFilter): Promise<GenreCountRow[]> {
    const query = this.db.executor()('movie_genres as g').join('movies as m', 'm.id', 'g.movie_id');
    return this.publicFiltered(query, filter)
      .select<GenreCountRow[]>('g.genre_id', this.db.executor().raw('count(*)::int AS count'))
      .groupBy('g.genre_id');
  }

  /** These movies, when public. */
  async findPublicByIds(ids: readonly number[]): Promise<MovieRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .executor()('movies as m')
      .select<MovieRow[]>(M_COLUMNS)
      .whereIn('m.id', [...ids])
      .whereIn('m.status', [...PUBLIC_MOVIE_STATUSES]);
  }

  /** The carousel: public movies with a position, by position (at most five). */
  async listFeatured(): Promise<MovieRow[]> {
    return this.movies()
      .select<MovieRow[]>(MOVIE_COLUMNS)
      .whereNotNull('featured_position')
      .whereIn('status', [...PUBLIC_MOVIE_STATUSES])
      .orderBy('featured_position');
  }

  /**
   * Now showing movies sharing at least one genre with the movie, most shared genres first, then
   * newest release, then id; the movie itself excluded.
   */
  async listSimilar(movieId: number, limit: number): Promise<SimilarMovieRow[]> {
    return this.db
      .executor()('movies as m')
      .join('movie_genres as g', 'g.movie_id', 'm.id')
      .select<SimilarMovieRow[]>(...M_COLUMNS, this.db.executor().raw('count(*)::int AS shared'))
      .where('m.status', 'now_showing' satisfies MovieStatus)
      .whereNot('m.id', movieId)
      .whereRaw(
        'g.genre_id IN (SELECT own.genre_id FROM movie_genres own WHERE own.movie_id = ?)',
        [movieId],
      )
      .groupBy('m.id')
      .orderBy([
        { column: 'shared', order: 'desc' },
        { column: 'm.release_date', order: 'desc' },
        { column: 'm.id', order: 'asc' },
      ])
      .limit(limit);
  }

  private movies(): Knex.QueryBuilder {
    return this.db.executor()('movies');
  }

  private adminFiltered(filter: AdminMovieListFilter): Knex.QueryBuilder {
    const query = this.db.executor()('movies as m');
    if (filter.status !== undefined) query.where('m.status', filter.status);
    if (filter.q !== undefined) {
      const pattern = containsPattern(filter.q);
      query.whereRaw(TITLE_OR_CAST_SQL, [pattern, pattern]);
    }
    return query;
  }

  /** Applies the public filters to a query that has `movies as m`. */
  private publicFiltered(
    query: Knex.QueryBuilder,
    filter: PublicMovieCountFilter,
  ): Knex.QueryBuilder {
    query.whereIn('m.status', filter.status ? [filter.status] : [...PUBLIC_MOVIE_STATUSES]);
    if (filter.q !== undefined) {
      const pattern = containsPattern(filter.q);
      query.whereRaw(TITLE_OR_CAST_SQL, [pattern, pattern]);
    }
    if (filter.genreIds !== undefined && filter.genreIds.length > 0) {
      query.whereRaw(
        'EXISTS (SELECT 1 FROM movie_genres fg WHERE fg.movie_id = m.id AND fg.genre_id = ANY(?::bigint[]))',
        [[...filter.genreIds]],
      );
    }
    if (filter.personIds !== undefined && filter.personIds.length > 0) {
      query.whereRaw(
        'EXISTS (SELECT 1 FROM movie_credits fc WHERE fc.movie_id = m.id AND fc.person_id = ANY(?::bigint[]))',
        [[...filter.personIds]],
      );
    }
    if (filter.movieIds !== undefined) {
      query.whereRaw('m.id = ANY(?::bigint[])', [[...filter.movieIds]]);
    }
    return query;
  }
}
