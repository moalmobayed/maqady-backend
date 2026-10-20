import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import type { Page, PageRequest } from '../../common/pagination/types';
import { CatalogReadService } from '../catalog/catalog-read.service';
import type {
  MovieDetails,
  MovieSummary,
  PublicMovieStatus,
  PublicPerson,
  PublicPersonFilter,
} from '../catalog/types';
import { compareByNameThenId, pageInMemory } from './in-memory-page';
import type { GenreWithCount, MovieListFilterInput, MovieListView } from './types';

/**
 * The catalog as customers browse it (PRD C1–C3), read through U6's `CatalogReadService` only.
 * Public means Coming soon or Now showing: a draft, an archived or an unknown movie is
 * `NOT_FOUND`, never a hint that it exists. Every method costs a fixed number of queries.
 */
@Injectable()
export class MovieBrowseService {
  constructor(private readonly catalog: CatalogReadService) {}

  /**
   * Every genre with how many public movies of `status` it has (both tabs when absent),
   * alphabetical. Two queries.
   */
  async genresWithCounts(status?: PublicMovieStatus): Promise<GenreWithCount[]> {
    const genres = await this.catalog.listGenres();
    const counts = await this.catalog.countPublicMoviesByGenre(
      status === undefined ? {} : { status },
    );
    return genres
      .map((genre) => ({ ...genre, movieCount: counts.get(genre.id) ?? 0 }))
      .sort(compareByNameThenId);
  }

  /** `GET /genres`: one page of `genresWithCounts()`. */
  async listGenres(
    status: PublicMovieStatus | undefined,
    page: PageRequest,
  ): Promise<Page<GenreWithCount>> {
    return pageInMemory(await this.genresWithCounts(status), page);
  }

  /**
   * `GET /movies`: one page of a tab with the filters, and both tabs' totals with the same
   * filters. Genre slugs become ids first; an unknown slug is `VALIDATION_FAILED` on `genres`.
   */
  async listMovies(input: MovieListFilterInput, page: PageRequest): Promise<MovieListView> {
    const genreIds = await this.genreIdsOf(input.genreSlugs ?? []);
    const shared = {
      ...(input.q === undefined ? {} : { q: input.q }),
      genreIds,
      personIds: input.personIds ?? [],
    };
    const result = await this.catalog.listPublicMovies({ ...shared, status: input.status }, page);
    const tabCounts = await this.catalog.countPublicMovies(shared);
    return { ...result, tabCounts };
  }

  /** `GET /movies/{id}`: a public movie's page; `NOT_FOUND` otherwise. */
  async findMovie(id: number): Promise<MovieDetails> {
    const movie = await this.catalog.findPublicMovie(id);
    if (!movie) throw new AppError('NOT_FOUND');
    return movie;
  }

  /** `GET /movies/{id}/similar`: "More like this" of a public movie; `NOT_FOUND` otherwise. */
  async listSimilar(id: number): Promise<readonly MovieSummary[]> {
    const found = await this.catalog.findPublicMoviesByIds([id]);
    if (!found.has(id)) throw new AppError('NOT_FOUND');
    return this.catalog.listSimilar(id);
  }

  /** `GET /people`: people credited on a public movie, by name. */
  async listPeople(filter: PublicPersonFilter, page: PageRequest): Promise<Page<PublicPerson>> {
    return this.catalog.listPublicPeople(filter, page);
  }

  /** The ids of genre slugs, in the order given; `VALIDATION_FAILED` naming unknown slugs. */
  private async genreIdsOf(slugs: readonly string[]): Promise<number[]> {
    if (slugs.length === 0) return [];
    const bySlug = new Map((await this.catalog.listGenres()).map((genre) => [genre.slug, genre]));
    const unknown = slugs.filter((slug) => !bySlug.has(slug));
    if (unknown.length > 0) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fields: [{ field: 'genres', messages: [`unknown genre: ${unknown.join(', ')}`] }],
      });
    }
    return [...new Set(slugs.map((slug) => bySlug.get(slug)!.id))];
  }
}
