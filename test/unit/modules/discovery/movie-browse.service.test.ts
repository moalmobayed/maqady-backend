import { AppError } from '../../../../src/common/errors/app-error';
import type { CatalogReadService } from '../../../../src/modules/catalog/catalog-read.service';
import type { MovieDetails, MovieSummary } from '../../../../src/modules/catalog/types';
import { PEOPLE_FACET_LIMIT } from '../../../../src/modules/discovery/discovery.constants';
import { MovieBrowseService } from '../../../../src/modules/discovery/movie-browse.service';
import type { ShowtimeBrowseService } from '../../../../src/modules/discovery/showtime-browse.service';
import type { MovieShowtimeSummary, ShowDateOption } from '../../../../src/modules/discovery/types';

const GENRES = [
  { id: 5, name: 'Drama', slug: 'drama' },
  { id: 1, name: 'Action', slug: 'action' },
  { id: 9, name: 'Sci-fi', slug: 'sci-fi' },
];

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

/** Friday 16 October 2026: the show-date options with the movies showing on each. */
const OPTIONS: ShowDateOption[] = [
  { value: 'today', cinemaDates: ['2026-10-16'], movieIds: [3, 8] },
  { value: 'tomorrow', cinemaDates: ['2026-10-17'], movieIds: [8, 11] },
  { value: 'weekend', cinemaDates: ['2026-10-16', '2026-10-17'], movieIds: [3, 8, 11] },
];

describe('MovieBrowseService', () => {
  let catalog: jest.Mocked<CatalogReadService>;
  let showtimes: jest.Mocked<Pick<ShowtimeBrowseService, 'showDateOptions' | 'summaryOf'>>;
  let service: MovieBrowseService;
  const summary: MovieShowtimeSummary = { nextShowToday: null, cinemaCount: 2, fromPrice: null };

  beforeEach(() => {
    catalog = {
      listGenres: jest.fn().mockResolvedValue(GENRES),
      countPublicMoviesByGenre: jest.fn().mockResolvedValue(
        new Map([
          [5, 3],
          [9, 1],
        ]),
      ),
      listPublicMovies: jest.fn().mockResolvedValue({ items: [], nextCursor: null, total: 0 }),
      countPublicMovies: jest.fn().mockResolvedValue({ now_showing: 4, coming_soon: 2 }),
      findPublicMovie: jest.fn().mockResolvedValue(null),
      findPublicMoviesByIds: jest.fn().mockResolvedValue(new Map()),
      listSimilar: jest.fn().mockResolvedValue([]),
      listPublicPeople: jest.fn(),
      countPublicCast: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      listPublicMovieIds: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<CatalogReadService>;
    showtimes = {
      showDateOptions: jest.fn().mockResolvedValue(OPTIONS),
      summaryOf: jest.fn().mockResolvedValue(summary),
    };
    service = new MovieBrowseService(catalog, showtimes as unknown as ShowtimeBrowseService);
  });

  describe('genresWithCounts', () => {
    it('gives every genre its count, 0 when it has none, alphabetical', async () => {
      expect(await service.genresWithCounts()).toEqual([
        { id: 1, name: 'Action', slug: 'action', movieCount: 0 },
        { id: 5, name: 'Drama', slug: 'drama', movieCount: 3 },
        { id: 9, name: 'Sci-fi', slug: 'sci-fi', movieCount: 1 },
      ]);
      expect(catalog.countPublicMoviesByGenre).toHaveBeenCalledWith({});
    });

    it('counts one tab when a status is given', async () => {
      await service.genresWithCounts('coming_soon');
      expect(catalog.countPublicMoviesByGenre).toHaveBeenCalledWith({ status: 'coming_soon' });
    });
  });

  describe('listMovies', () => {
    it('turns genre slugs into ids and counts both tabs with the same filters', async () => {
      const page = { after: null, limit: 20 };
      const view = await service.listMovies(
        {
          status: 'now_showing',
          genreSlugs: ['sci-fi', 'drama', 'sci-fi'],
          q: 'light',
          personIds: [4],
        },
        page,
      );
      const shared = { q: 'light', genreIds: [9, 5], personIds: [4] };
      expect(catalog.listPublicMovies).toHaveBeenCalledWith(
        { ...shared, status: 'now_showing' },
        page,
      );
      expect(catalog.countPublicMovies).toHaveBeenCalledWith(shared);
      expect(view).toEqual({
        items: [],
        nextCursor: null,
        total: 0,
        tabCounts: { now_showing: 4, coming_soon: 2 },
        facets: expect.any(Object),
      });
    });

    it('passes no filter for an empty or missing list, and reads the genres once', async () => {
      await service.listMovies({ status: 'coming_soon' }, { after: null, limit: 20 });
      expect(catalog.listGenres).toHaveBeenCalledTimes(1);
      expect(catalog.listPublicMovies).toHaveBeenCalledWith(
        { genreIds: [], personIds: [], status: 'coming_soon' },
        { after: null, limit: 20 },
      );
    });

    it('refuses an unknown genre slug with VALIDATION_FAILED on genres', async () => {
      const error = await rejection(
        service.listMovies(
          { status: 'now_showing', genreSlugs: ['drama', 'western'] },
          { after: null, limit: 20 },
        ),
      );
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details).toEqual({
        fields: [{ field: 'genres', messages: ['unknown genre: western'] }],
      });
      expect(catalog.listPublicMovies).not.toHaveBeenCalled();
    });

    it('keeps the movies showing on the show date, and counts only the Now showing tab with it', async () => {
      const page = { after: null, limit: 20 };
      catalog.listPublicMovies.mockResolvedValue({ items: [], nextCursor: null, total: 1 });
      const view = await service.listMovies({ status: 'now_showing', showDate: 'weekend' }, page);
      expect(showtimes.showDateOptions).toHaveBeenCalledTimes(1);
      expect(catalog.listPublicMovies).toHaveBeenCalledWith(
        { genreIds: [], personIds: [], status: 'now_showing', movieIds: [3, 8, 11] },
        page,
      );
      // The Coming soon count has no show date filter: the tab doesn't offer it.
      expect(catalog.countPublicMovies).toHaveBeenCalledWith({ genreIds: [], personIds: [] });
      expect(view.tabCounts).toEqual({ now_showing: 1, coming_soon: 2 });
    });

    it('lists without a movie id filter when there is no show date', async () => {
      await service.listMovies({ status: 'now_showing' }, { after: null, limit: 20 });
      expect(catalog.listPublicMovies.mock.calls[0]![0]).not.toHaveProperty('movieIds');
    });

    it('refuses a show date on the Coming soon tab with VALIDATION_FAILED on showDate', async () => {
      const error = await rejection(
        service.listMovies(
          { status: 'coming_soon', showDate: 'today' },
          { after: null, limit: 20 },
        ),
      );
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details).toEqual({
        fields: [{ field: 'showDate', messages: ['showDate applies to the now_showing tab only'] }],
      });
      expect(showtimes.showDateOptions).not.toHaveBeenCalled();
    });
  });

  describe('listMovies facets', () => {
    const page = { after: null, limit: 2 };

    it('counts every genre without the genre filter, alphabetical, 0 for none', async () => {
      const view = await service.listMovies(
        { status: 'now_showing', genreSlugs: ['drama'], personIds: [4], q: 'nile' },
        page,
      );
      // The genre facet keeps every filter but its own.
      expect(catalog.countPublicMoviesByGenre).toHaveBeenCalledWith({
        status: 'now_showing',
        q: 'nile',
        personIds: [4],
      });
      expect(view.facets.genres).toEqual([
        { id: 1, name: 'Action', slug: 'action', count: 0 },
        { id: 5, name: 'Drama', slug: 'drama', count: 3 },
        { id: 9, name: 'Sci-fi', slug: 'sci-fi', count: 1 },
      ]);
    });

    it('lists the cast without the people filter, capped, with the total', async () => {
      const karim = { id: 4, fullName: 'Karim Fahmy', photo: null, count: 2 };
      catalog.countPublicCast.mockResolvedValue({ items: [karim], total: 41 });
      const view = await service.listMovies(
        { status: 'coming_soon', genreSlugs: ['sci-fi'], personIds: [4, 6] },
        page,
      );
      expect(catalog.countPublicCast).toHaveBeenCalledWith(
        { status: 'coming_soon', genreIds: [9] },
        PEOPLE_FACET_LIMIT,
      );
      expect(view.facets.people).toEqual([karim]);
      expect(view.facets.peopleTotal).toBe(41);
    });

    it('counts each show date among the movies matching the other filters', async () => {
      catalog.listPublicMovieIds.mockResolvedValue([8, 11]);
      const view = await service.listMovies(
        { status: 'now_showing', genreSlugs: ['action'], q: 'sand' },
        page,
      );
      // One id query over every movie showing on any option, with the filters but no show date.
      expect(catalog.listPublicMovieIds).toHaveBeenCalledTimes(1);
      expect(catalog.listPublicMovieIds).toHaveBeenCalledWith({
        status: 'now_showing',
        q: 'sand',
        genreIds: [1],
        personIds: [],
        movieIds: [3, 8, 11],
      });
      expect(view.facets.showDates).toEqual([
        { value: 'today', count: 1, cinemaDates: ['2026-10-16'] },
        { value: 'tomorrow', count: 2, cinemaDates: ['2026-10-17'] },
        { value: 'weekend', count: 2, cinemaDates: ['2026-10-16', '2026-10-17'] },
      ]);
    });

    it("narrows the genre and cast facets by the show date, but not the show dates' own counts", async () => {
      catalog.listPublicMovieIds.mockResolvedValue([3, 8, 11]);
      const view = await service.listMovies({ status: 'now_showing', showDate: 'today' }, page);
      expect(catalog.countPublicMoviesByGenre).toHaveBeenCalledWith({
        status: 'now_showing',
        personIds: [],
        movieIds: [3, 8],
      });
      expect(catalog.countPublicCast).toHaveBeenCalledWith(
        { status: 'now_showing', genreIds: [], movieIds: [3, 8] },
        PEOPLE_FACET_LIMIT,
      );
      expect(catalog.listPublicMovieIds.mock.calls[0]![0]).toMatchObject({
        movieIds: [3, 8, 11],
      });
      expect(view.facets.showDates.map((option) => option.count)).toEqual([2, 2, 3]);
    });

    it('asks no ids when no movie is showing on any option, and counts 0', async () => {
      showtimes.showDateOptions.mockResolvedValue(
        OPTIONS.map((option) => ({ ...option, movieIds: [] })),
      );
      const view = await service.listMovies({ status: 'now_showing' }, page);
      expect(catalog.listPublicMovieIds).not.toHaveBeenCalled();
      expect(view.facets.showDates.map((option) => option.count)).toEqual([0, 0, 0]);
      expect(view.facets.showDates.map((option) => option.value)).toEqual([
        'today',
        'tomorrow',
        'weekend',
      ]);
    });
  });

  describe('findMovie', () => {
    it('is NOT_FOUND when the catalog has no public movie with that id', async () => {
      expect((await rejection(service.findMovie(7))).code).toBe('NOT_FOUND');
      expect(showtimes.summaryOf).not.toHaveBeenCalled();
    });

    it('returns the public movie with its side panel', async () => {
      const movie = { id: 7, status: 'now_showing' } as MovieDetails;
      catalog.findPublicMovie.mockResolvedValue(movie);
      expect(await service.findMovie(7)).toEqual({ movie, showtimeSummary: summary });
      expect(showtimes.summaryOf).toHaveBeenCalledWith(movie);
    });
  });

  describe('listSimilar', () => {
    it('is NOT_FOUND for a movie that is not public, without ranking anything', async () => {
      expect((await rejection(service.listSimilar(7))).code).toBe('NOT_FOUND');
      expect(catalog.listSimilar).not.toHaveBeenCalled();
    });

    it('returns the similar movies of a public movie', async () => {
      const similar = [{ id: 8 } as MovieSummary];
      catalog.findPublicMoviesByIds.mockResolvedValue(new Map([[7, { id: 7 } as MovieSummary]]));
      catalog.listSimilar.mockResolvedValue(similar);
      expect(await service.listSimilar(7)).toBe(similar);
      expect(catalog.listSimilar).toHaveBeenCalledWith(7);
    });
  });
});
