import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { StaffPrincipal } from '../../../../src/common/auth/types';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { AppError } from '../../../../src/common/errors/app-error';
import type { CatalogAssembler } from '../../../../src/modules/catalog/catalog-assembler.service';
import type { CreditsRepository } from '../../../../src/modules/catalog/credits.repository';
import type { GenresRepository } from '../../../../src/modules/catalog/genres.repository';
import { MovieLifecycleRegistry } from '../../../../src/modules/catalog/movie-lifecycle.registry';
import type { MovieMediaRepository } from '../../../../src/modules/catalog/movie-media.repository';
import type { MoviesRepository } from '../../../../src/modules/catalog/movies.repository';
import { MoviesService } from '../../../../src/modules/catalog/movies.service';
import type { MovieRow } from '../../../../src/modules/catalog/types';
import type { MediaService } from '../../../../src/modules/media/media.service';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-16T12:00:00Z');
const ACTOR: StaffPrincipal = { kind: 'staff', id: 3, sessionId: 30, role: 'admin' };

function movieRow(overrides: Partial<MovieRow> = {}): MovieRow {
  return {
    id: 1,
    title: 'The Last Lighthouse',
    status: 'now_showing',
    synopsis: 'A synopsis.',
    runtime_minutes: 128,
    release_date: '2026-10-01',
    age_rating: '12+',
    language: null,
    country: null,
    production_company: null,
    budget_label: null,
    filming_locations: null,
    poster_image_id: null,
    backdrop_photo_id: null,
    hero_video_id: 11,
    featured_position: null,
    updated_by_staff_id: 1,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('MoviesService', () => {
  let movies: jest.Mocked<MoviesRepository>;
  let genres: jest.Mocked<GenresRepository>;
  let movieMedia: jest.Mocked<MovieMediaRepository>;
  let credits: jest.Mocked<CreditsRepository>;
  let media: jest.Mocked<MediaService>;
  let audit: jest.Mocked<AuditService>;
  let lifecycle: MovieLifecycleRegistry;
  let service: MoviesService;

  beforeEach(() => {
    movies = {
      findByIdForUpdate: jest.fn().mockResolvedValue(movieRow()),
      findByIdForDelete: jest.fn().mockResolvedValue(movieRow({ poster_image_id: 50 })),
      findByFeaturedPosition: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(movieRow()),
      deleteById: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MoviesRepository>;
    genres = {
      genresOf: jest
        .fn()
        .mockResolvedValue([{ movie_id: 1, sort_order: 0, id: 5, name: 'Drama', slug: 'drama' }]),
      findByIds: jest.fn().mockResolvedValue([]),
      replaceMovieGenres: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<GenresRepository>;
    movieMedia = {
      findVideo: jest.fn(),
      findPhoto: jest.fn(),
      photosOf: jest.fn().mockResolvedValue([{ id: 7, image_id: 51 }]),
      videosOf: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<MovieMediaRepository>;
    credits = {
      countsByMovie: jest.fn().mockResolvedValue(new Map([[1, 4]])),
    } as unknown as jest.Mocked<CreditsRepository>;
    media = {
      findByIds: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MediaService>;
    audit = { record: jest.fn().mockResolvedValue(1) } as unknown as jest.Mocked<AuditService>;
    const assembler = {
      adminMovie: jest.fn().mockResolvedValue({ id: 1 }),
    } as unknown as CatalogAssembler;
    const transactions = {
      run: jest.fn((fn: () => Promise<unknown>) => fn()),
    } as unknown as TransactionRepository;
    lifecycle = new MovieLifecycleRegistry();
    service = new MoviesService(
      movies,
      genres,
      movieMedia,
      credits,
      media,
      assembler,
      lifecycle,
      transactions,
      audit,
      new TestClock(NOW),
    );
  });

  const actions = (): string[] => audit.record.mock.calls.map(([event]) => event.action);

  describe('update', () => {
    it('writes nothing and records nothing for a change to the current values', async () => {
      await service.update(ACTOR, 1, { title: 'The Last Lighthouse', genreIds: [5] });
      expect(movies.update).not.toHaveBeenCalled();
      expect(genres.replaceMovieGenres).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('records the changed field names, then the status change, with the editor', async () => {
      movies.findByIdForUpdate.mockResolvedValue(movieRow({ status: 'draft' }));
      await service.update(ACTOR, 1, { title: 'New title', status: 'coming_soon' });

      expect(movies.update).toHaveBeenCalledWith(1, {
        title: 'New title',
        status: 'coming_soon',
        updated_at: NOW,
        updated_by_staff_id: ACTOR.id,
      });
      expect(
        audit.record.mock.calls.map(([event]) => [
          event.action,
          event.changedFields,
          event.metadata,
        ]),
      ).toEqual([
        ['movie.updated', ['title'], undefined],
        ['movie.status_changed', undefined, { from: 'draft', to: 'coming_soon' }],
      ]);
    });

    it('frees the carousel position when a featured movie is archived, and says so', async () => {
      movies.findByIdForUpdate.mockResolvedValue(movieRow({ featured_position: 2 }));
      await service.update(ACTOR, 1, { status: 'archived' });

      expect(movies.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ status: 'archived', featured_position: null }),
      );
      expect(actions()).toEqual(['movie.status_changed', 'movie.unfeatured']);
      expect(audit.record.mock.calls[1]![0].metadata).toEqual({ previousPosition: 2 });
    });

    it('refuses a position another movie holds, naming the holder', async () => {
      movies.findByFeaturedPosition.mockResolvedValue({ id: 9 });
      const error = await rejection(service.update(ACTOR, 1, { featuredPosition: 1 }));
      expect(error.code).toBe('FEATURED_POSITION_TAKEN');
      expect(error.details).toEqual({ position: 1, movieId: 9 });
      expect(movies.update).not.toHaveBeenCalled();
    });

    it('refuses a disallowed status change with its from and to', async () => {
      const error = await rejection(service.update(ACTOR, 1, { status: 'draft' }));
      expect(error.code).toBe('CONFLICT');
      expect(error.details).toEqual({ from: 'now_showing', to: 'draft' });
    });

    it('refuses clearing a required field of a public movie', async () => {
      const error = await rejection(service.update(ACTOR, 1, { runtimeMinutes: null }));
      expect(error.code).toBe('MOVIE_NOT_PUBLISHABLE');
      expect(error.details).toEqual({ missing: ['runtimeMinutes'] });
    });

    it('refuses a hero video of another movie before anything is written', async () => {
      movieMedia.findVideo.mockResolvedValue(undefined);
      const error = await rejection(service.update(ACTOR, 1, { heroVideoId: 99 }));
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(movieMedia.findVideo).toHaveBeenCalledWith(1, 99);
      expect(movies.update).not.toHaveBeenCalled();
    });

    it('answers NOT_FOUND for a movie that does not exist', async () => {
      movies.findByIdForUpdate.mockResolvedValue(undefined);
      expect((await rejection(service.update(ACTOR, 1, { title: 'x' }))).code).toBe('NOT_FOUND');
    });
  });

  describe('delete', () => {
    it('refuses with the keys of the blockers that apply, and deletes nothing', async () => {
      lifecycle.addDeletionBlocker({ key: 'has_showtimes', blocks: () => Promise.resolve(false) });
      lifecycle.addDeletionBlocker({ key: 'has_bookings', blocks: () => Promise.resolve(true) });

      const error = await rejection(service.delete(ACTOR, 1));
      expect(error.code).toBe('MOVIE_NOT_DELETABLE');
      expect(error.details).toEqual({ reasons: ['has_bookings'] });
      expect(movies.deleteById).not.toHaveBeenCalled();
      expect(media.deleteMany).not.toHaveBeenCalled();
    });

    it('deletes the movie, then its poster and photo images, and records the counts', async () => {
      await service.delete(ACTOR, 1);
      expect(movies.deleteById).toHaveBeenCalledWith(1);
      expect(media.deleteMany).toHaveBeenCalledWith([50, 51]);
      expect(movies.deleteById.mock.invocationCallOrder[0]).toBeLessThan(
        media.deleteMany.mock.invocationCallOrder[0]!,
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'movie.deleted',
          metadata: { photoCount: 1, videoCount: 0, creditCount: 4 },
        }),
      );
    });
  });
});
