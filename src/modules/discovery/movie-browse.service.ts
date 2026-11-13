import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import type { Page, PageRequest } from '../../common/pagination/types';
import { CatalogReadService } from '../catalog/catalog-read.service';
import type {
  GenreRef,
  MovieSummary,
  PublicMovieStatus,
  PublicPerson,
  PublicPersonFilter,
} from '../catalog/types';
import { PEOPLE_FACET_LIMIT } from './discovery.constants';
import { compareByNameThenId, pageInMemory } from './in-memory-page';
import { ShowtimeBrowseService } from './showtime-browse.service';
import type {
  GenreWithCount,
  MovieFacetFilters,
  MovieFacets,
  MovieListFilterInput,
  MovieListView,
  PublicMovieView,
  ShowDateOption,
} from './types';

/**
 * The catalog as customers browse it (PRD C1–C3), read through U6's `CatalogReadService` only.
 * Public means Coming soon or Now showing: a draft, an archived or an unknown movie is
 * `NOT_FOUND`, never a hint that it exists. Every method costs a fixed number of queries.
 */
@Injectable()
export class MovieBrowseService {
  constructor(
    private readonly catalog: CatalogReadService,
    private readonly showtimes: ShowtimeBrowseService,
  ) {}

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
   * `GET /movies`: one page of a tab with the filters, both tabs' totals with the same filters,
   * and the sidebar facets. Genre slugs become ids first; an unknown slug is `VALIDATION_FAILED`
   * on `genres`. `showDate` keeps the Now showing movies with a showtime still to start on its
   * cinema dates; it belongs to that tab only (`VALIDATION_FAILED` on `showDate` with Coming
   * soon), so the Coming soon count ignores it. A fixed number of queries.
   */
  async listMovies(input: MovieListFilterInput, page: PageRequest): Promise<MovieListView> {
    if (input.showDate !== undefined && input.status !== 'now_showing') {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fields: [{ field: 'showDate', messages: ['showDate applies to the now_showing tab only'] }],
      });
    }
    const genres = await this.catalog.listGenres();
    const filters: MovieFacetFilters = {
      status: input.status,
      ...(input.q === undefined ? {} : { q: input.q }),
      genreIds: this.genreIdsOf(input.genreSlugs ?? [], genres),
      personIds: input.personIds ?? [],
    };
    const options = await this.showtimes.showDateOptions();
    const movieIds =
      input.showDate === undefined
        ? undefined
        : options.find((option) => option.value === input.showDate)!.movieIds;
    const { status, ...shared } = filters;
    const result = await this.catalog.listPublicMovies(
      { ...shared, status, ...(movieIds === undefined ? {} : { movieIds }) },
      page,
    );
    const counts = await this.catalog.countPublicMovies(shared);
    const tabCounts = movieIds === undefined ? counts : { ...counts, now_showing: result.total };
    const facets = await this.facetsOf(filters, movieIds, genres, options);
    return { ...result, tabCounts, facets };
  }

  /**
   * `GET /movies/{id}`: a public movie's page and its side panel (next show today, cinemas,
   * "from" price); `NOT_FOUND` otherwise.
   */
  async findMovie(id: number): Promise<PublicMovieView> {
    const movie = await this.catalog.findPublicMovie(id);
    if (!movie) throw new AppError('NOT_FOUND');
    return { movie, showtimeSummary: await this.showtimes.summaryOf(movie) };
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

  /**
   * The Movies page facets (#29) over every movie of the tab matching the filters, each facet
   * without its own filter: genre counts (one query), the cast (two at most) and the show-date
   * counts (one, none when no movie is showing or on Coming soon). `movieIds` is the `showDate`
   * filter's movies.
   */
  private async facetsOf(
    filters: MovieFacetFilters,
    movieIds: readonly number[] | undefined,
    genres: readonly GenreRef[],
    options: readonly ShowDateOption[],
  ): Promise<MovieFacets> {
    const { genreIds, personIds, ...base } = filters;
    const showing = movieIds === undefined ? {} : { movieIds };
    const genreCounts = await this.catalog.countPublicMoviesByGenre({
      ...base,
      personIds,
      ...showing,
    });
    const cast = await this.catalog.countPublicCast(
      { ...base, genreIds, ...showing },
      PEOPLE_FACET_LIMIT,
    );
    // `showDate` belongs to Now showing: a Coming soon movie left with a showtime (archived,
    // then brought back) is never what the filter lists, so it never counts either.
    const anyShowing =
      filters.status === 'now_showing'
        ? [...new Set(options.flatMap((option) => option.movieIds))]
        : [];
    const matching = new Set(
      anyShowing.length === 0
        ? []
        : await this.catalog.listPublicMovieIds({ ...filters, movieIds: anyShowing }),
    );
    return {
      genres: [...genres]
        .sort(compareByNameThenId)
        .map((genre) => ({ ...genre, count: genreCounts.get(genre.id) ?? 0 })),
      people: cast.items,
      peopleTotal: cast.total,
      showDates: options.map((option) => ({
        value: option.value,
        count: option.movieIds.filter((id) => matching.has(id)).length,
        cinemaDates: option.cinemaDates,
      })),
    };
  }

  /** The ids of genre slugs, in the order given; `VALIDATION_FAILED` naming unknown slugs. */
  private genreIdsOf(slugs: readonly string[], genres: readonly GenreRef[]): number[] {
    if (slugs.length === 0) return [];
    const bySlug = new Map(genres.map((genre) => [genre.slug, genre]));
    const unknown = slugs.filter((slug) => !bySlug.has(slug));
    if (unknown.length > 0) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fields: [{ field: 'genres', messages: [`unknown genre: ${unknown.join(', ')}`] }],
      });
    }
    return [...new Set(slugs.map((slug) => bySlug.get(slug)!.id))];
  }
}
