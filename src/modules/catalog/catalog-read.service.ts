import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { toPage } from '../../common/pagination/cursor';
import { INVALID_CURSOR_MESSAGE } from '../../common/pagination/pagination.constants';
import type { Page, PageRequest } from '../../common/pagination/types';
import { MediaService } from '../media/media.service';
import { CatalogAssembler } from './catalog-assembler.service';
import { SIMILAR_MOVIES_LIMIT } from './catalog.constants';
import { PUBLIC_MOVIE_STATUSES } from './enums';
import { GenresRepository } from './genres.repository';
import { isPublicStatus } from './movie-rules';
import { MoviesRepository } from './movies.repository';
import { PeopleRepository } from './people.repository';
import type {
  FeaturedMovie,
  GenreRef,
  MovieDetails,
  MovieRef,
  MovieSchedulingInfo,
  MovieSummary,
  PublicMovieCountFilter,
  PublicMovieFilter,
  PublicMovieStatus,
  PublicMovieTabFilter,
  PublicPerson,
  PublicPersonFilter,
} from './types';
import { inSequence } from './sequential';

/**
 * The catalog as other modules read it (exported by `CatalogModule`), so no other module
 * touches a catalog table (design §5):
 *
 * - U8 discovery: genres, the public movie lists and counts, a movie's page, the home carousel,
 *   similar movies and the people filter. Public means Coming soon or Now showing; drafts and
 *   archived movies never appear. Each call costs a fixed number of queries.
 * - U7 scheduling: `lockMovieForShare` inside the scheduling transaction, and `findMoviesByIds`
 *   for the admin timeline (any status).
 */
@Injectable()
export class CatalogReadService {
  constructor(
    private readonly movies: MoviesRepository,
    private readonly genres: GenresRepository,
    private readonly people: PeopleRepository,
    private readonly assembler: CatalogAssembler,
    private readonly media: MediaService,
  ) {}

  /** Every genre, alphabetical. */
  async listGenres(): Promise<readonly GenreRef[]> {
    const rows = await this.genres.listAll();
    return rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug }));
  }

  /** Genre id → how many public movies (of `status`, or both) match the filters. */
  async countPublicMoviesByGenre(
    filter: PublicMovieCountFilter = {},
  ): Promise<ReadonlyMap<number, number>> {
    const rows = await this.movies.publicCountsByGenre(filter);
    return new Map(rows.map((row) => [row.genre_id, row.count]));
  }

  /** How many movies each public tab has with these filters. */
  async countPublicMovies(
    filter: PublicMovieTabFilter = {},
  ): Promise<Readonly<Record<PublicMovieStatus, number>>> {
    const rows = await this.movies.publicCountsByStatus(filter);
    const counts = Object.fromEntries(PUBLIC_MOVIE_STATUSES.map((status) => [status, 0])) as Record<
      PublicMovieStatus,
      number
    >;
    for (const row of rows) counts[row.status] = row.count;
    return counts;
  }

  /**
   * One page of a public tab: Now showing newest release first, Coming soon soonest first, ties
   * by id. The cursor's sort key is the release date (`toPageRequest(query, 'text')`).
   */
  async listPublicMovies(
    filter: PublicMovieFilter,
    page: PageRequest,
  ): Promise<Page<MovieSummary>> {
    if (
      page.after &&
      (typeof page.after.sortKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(page.after.sortKey))
    ) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fields: [{ field: 'cursor', messages: [INVALID_CURSOR_MESSAGE] }],
      });
    }
    const [rows, total] = await inSequence([
      () => this.movies.publicList(filter, page),
      () => this.movies.publicCount(filter),
    ]);
    const rowPage = toPage(
      rows,
      page,
      total,
      (row) => ({ sortKey: row.release_date, id: row.id }),
      (row) => row,
    );
    return { ...rowPage, items: await this.assembler.summaries(rowPage.items) };
  }

  /** These movies when public, by id; drafts, archived and unknown ids are absent. */
  async findPublicMoviesByIds(ids: readonly number[]): Promise<ReadonlyMap<number, MovieSummary>> {
    const rows = await this.movies.findPublicByIds([...new Set(ids)]);
    const summaries = await this.assembler.summaries(rows);
    return new Map(summaries.map((summary) => [summary.id, summary]));
  }

  /** A public movie's page, or null when it doesn't exist or isn't public. */
  async findPublicMovie(id: number): Promise<MovieDetails | null> {
    const row = await this.movies.findById(id);
    if (!row || !isPublicStatus(row.status)) return null;
    return this.assembler.details(row);
  }

  /** The home carousel: up to five public movies with their hero video, by position. */
  async listFeatured(): Promise<readonly FeaturedMovie[]> {
    return this.assembler.featured(await this.movies.listFeatured());
  }

  /**
   * Up to `limit` Now showing movies sharing the most genres with the movie (PRD C3 "More like
   * this"), then newest release first; never the movie itself.
   */
  async listSimilar(
    movieId: number,
    limit = SIMILAR_MOVIES_LIMIT,
  ): Promise<readonly MovieSummary[]> {
    return this.assembler.summaries(await this.movies.listSimilar(movieId, limit));
  }

  /** People credited on a public movie, by name then id (the cast filter of PRD C2). */
  async listPublicPeople(
    filter: PublicPersonFilter,
    page: PageRequest,
  ): Promise<Page<PublicPerson>> {
    if (page.after && typeof page.after.sortKey !== 'string') {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fields: [{ field: 'cursor', messages: [INVALID_CURSOR_MESSAGE] }],
      });
    }
    const [rows, total] = await inSequence([
      () => this.people.publicList(filter, page),
      () => this.people.publicCount(filter),
    ]);
    const rowPage = toPage(
      rows,
      page,
      total,
      (row) => ({ sortKey: row.full_name, id: row.id }),
      (row) => row,
    );
    return { ...rowPage, items: await this.assembler.publicPeople(rowPage.items) };
  }

  /**
   * U7: the movie locked `FOR SHARE` in the open transaction, any status, or null. A status
   * change (which locks the movie `FOR NO KEY UPDATE`) waits until that transaction ends, so a
   * showtime is never scheduled for a movie being archived at the same moment.
   */
  async lockMovieForShare(id: number): Promise<MovieSchedulingInfo | null> {
    const row = await this.movies.findByIdForShare(id);
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      runtimeMinutes: row.runtime_minutes,
    };
  }

  /** U7: movies of any status by id, with their posters; unknown ids are absent. */
  async findMoviesByIds(ids: readonly number[]): Promise<ReadonlyMap<number, MovieRef>> {
    const rows = await this.movies.findByIds([...new Set(ids)]);
    const images = await this.media.findByIds(
      rows.flatMap((row) => (row.poster_image_id === null ? [] : [row.poster_image_id])),
    );
    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          title: row.title,
          status: row.status,
          runtimeMinutes: row.runtime_minutes,
          ageRating: row.age_rating,
          poster: row.poster_image_id === null ? null : (images.get(row.poster_image_id) ?? null),
        },
      ]),
    );
  }
}
