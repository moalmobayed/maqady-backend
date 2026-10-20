import { AppError } from '../../../../src/common/errors/app-error';
import type { CatalogReadService } from '../../../../src/modules/catalog/catalog-read.service';
import type { MovieDetails, MovieSummary } from '../../../../src/modules/catalog/types';
import { MovieBrowseService } from '../../../../src/modules/discovery/movie-browse.service';

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

describe('MovieBrowseService', () => {
  let catalog: jest.Mocked<CatalogReadService>;
  let service: MovieBrowseService;

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
    } as unknown as jest.Mocked<CatalogReadService>;
    service = new MovieBrowseService(catalog);
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
      });
    });

    it('passes no filter for an empty or missing list, and reads no genres then', async () => {
      await service.listMovies({ status: 'coming_soon' }, { after: null, limit: 20 });
      expect(catalog.listGenres).not.toHaveBeenCalled();
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
  });

  describe('findMovie', () => {
    it('is NOT_FOUND when the catalog has no public movie with that id', async () => {
      expect((await rejection(service.findMovie(7))).code).toBe('NOT_FOUND');
    });

    it('returns the public movie', async () => {
      const movie = { id: 7 } as MovieDetails;
      catalog.findPublicMovie.mockResolvedValue(movie);
      expect(await service.findMovie(7)).toBe(movie);
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
