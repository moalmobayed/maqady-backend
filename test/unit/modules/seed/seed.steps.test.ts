import { MAX_MOVIE_RATING, TEXT_LIMITS } from '../../../../src/modules/catalog/catalog.constants';
import { SEED_DATASETS } from '../../../../src/modules/seed/datasets';
import { SEED_STEPS } from '../../../../src/modules/seed/seed.steps';
import type {
  SeedAdminMovie,
  SeedApi,
  SeedContext,
  SeedMovie,
  SeedWriteMethod,
} from '../../../../src/modules/seed/types';

/** A draft dataset movie with no pictures, videos or credits, so the step only creates and patches. */
function seedMovie(overrides: Partial<SeedMovie> = {}): SeedMovie {
  return {
    title: 'The Last Lighthouse',
    status: 'draft',
    synopsis: 'A synopsis.',
    runtimeMinutes: 120,
    releaseInDays: -10,
    ageRating: null,
    language: 'Arabic',
    country: 'Egypt',
    productionCompany: null,
    budgetLabel: null,
    filmingLocations: null,
    genres: ['drama'],
    videos: [],
    photos: [],
    credits: [],
    featuredPosition: null,
    colour: '#1f4e79',
    posterUrl: null,
    ...overrides,
  };
}

function adminMovie(overrides: Partial<SeedAdminMovie> = {}): SeedAdminMovie {
  return {
    id: 41,
    status: 'draft',
    rating: null,
    poster: null,
    backdropPhotoId: null,
    heroVideoId: null,
    featuredPosition: null,
    photos: [],
    videos: [],
    credits: [],
    ...overrides,
  };
}

interface Write {
  readonly method: SeedWriteMethod;
  readonly path: string;
  readonly body: Record<string, unknown>;
}

/**
 * The admin API as the `movies` step sees it: one genre, the movies `existing` lists, and
 * `GET /admin/movies/41` answering `stored`. Writes are recorded, never applied.
 */
function fakeApi(existing: readonly { id: number; title: string }[], stored: SeedAdminMovie) {
  const writes: Write[] = [];
  const api: SeedApi = {
    get: <T>(path: string): Promise<T> => {
      const route = path.split('?')[0];
      if (route === '/genres') {
        return Promise.resolve({ items: [{ id: 5, slug: 'drama' }], nextCursor: null } as T);
      }
      if (route === '/admin/movies') {
        return Promise.resolve({ items: existing, nextCursor: null } as T);
      }
      if (route === '/admin/movies/41') return Promise.resolve(stored as T);
      return Promise.reject(new Error(`unexpected GET ${path}`));
    },
    write: <T>(method: SeedWriteMethod, path: string, body: unknown): Promise<T> => {
      writes.push({ method, path, body: body as Record<string, unknown> });
      return Promise.resolve({ id: 41 } as T);
    },
    upload: () => Promise.reject(new Error('unexpected upload')),
  };
  return { api, writes };
}

function context(api: SeedApi, movies: readonly SeedMovie[]): SeedContext {
  return {
    api,
    dataset: { name: 'test', theaters: [], people: [], movies, showtimes: [] },
    today: '2026-11-13',
    theaterIds: new Map(),
    hallIds: new Map(),
    personIds: new Map(),
    movieIds: new Map(),
  };
}

const moviesStep = SEED_STEPS.find((step) => step.name === 'movies')!;

describe('the seed movies step: the rating score (#29)', () => {
  it('sends the score and its source when it creates a movie', async () => {
    const { api, writes } = fakeApi([], adminMovie({ rating: 8.4 }));
    const result = await moviesStep.run(
      context(api, [seedMovie({ rating: 8.4, ratingSource: 'elCinema users' })]),
    );

    expect(result).toEqual({ created: 1, kept: 0 });
    expect(writes).toEqual([
      {
        method: 'POST',
        path: '/admin/movies',
        body: expect.objectContaining({
          title: 'The Last Lighthouse',
          rating: 8.4,
          ratingSource: 'elCinema users',
        }),
      },
    ]);
  });

  it('back-fills the score of a movie seeded before it had one, with one PATCH', async () => {
    const { api, writes } = fakeApi(
      [{ id: 41, title: 'The Last Lighthouse' }],
      adminMovie({ rating: null }),
    );
    const result = await moviesStep.run(
      context(api, [seedMovie({ rating: 7.9, ratingSource: 'elCinema users' })]),
    );

    expect(result).toEqual({ created: 0, kept: 1 });
    expect(writes).toEqual([
      {
        method: 'PATCH',
        path: '/admin/movies/41',
        body: { rating: 7.9, ratingSource: 'elCinema users' },
      },
    ]);
  });

  it('back-fills a score without a source', async () => {
    const { api, writes } = fakeApi(
      [{ id: 41, title: 'The Last Lighthouse' }],
      adminMovie({ rating: null }),
    );
    await moviesStep.run(context(api, [seedMovie({ rating: 6 })]));
    expect(writes.map((write) => write.body)).toEqual([{ rating: 6 }]);
  });

  it('leaves alone a movie that already has a score, whatever the dataset says', async () => {
    const { api, writes } = fakeApi(
      [{ id: 41, title: 'The Last Lighthouse' }],
      adminMovie({ rating: 5.5 }),
    );
    await moviesStep.run(context(api, [seedMovie({ rating: 8.4, ratingSource: 'elCinema' })]));
    expect(writes).toEqual([]);
  });

  it('sends no score for a dataset movie without one', async () => {
    const created = fakeApi([], adminMovie());
    await moviesStep.run(context(created.api, [seedMovie()]));
    expect(created.writes).toHaveLength(1);
    expect(created.writes[0]!.body).not.toHaveProperty('rating');
    expect(created.writes[0]!.body).not.toHaveProperty('ratingSource');

    const existing = fakeApi([{ id: 41, title: 'The Last Lighthouse' }], adminMovie());
    await moviesStep.run(context(existing.api, [seedMovie()]));
    expect(existing.writes).toEqual([]);
  });

  it.each(Object.values(SEED_DATASETS).map((dataset) => [dataset.name, dataset] as const))(
    'the %s dataset gives only scores the admin API accepts',
    (_name, dataset) => {
      for (const movie of dataset.movies) {
        const problems = [
          movie.rating !== undefined &&
            !(movie.rating >= 0 && movie.rating <= MAX_MOVIE_RATING) &&
            'rating out of range',
          movie.rating !== undefined &&
            Math.round(movie.rating * 10) / 10 !== movie.rating &&
            'rating with more than one decimal',
          movie.ratingSource !== undefined && movie.rating === undefined && 'source without rating',
          movie.ratingSource !== undefined &&
            (movie.ratingSource.trim() !== movie.ratingSource ||
              movie.ratingSource.length < 1 ||
              movie.ratingSource.length > TEXT_LIMITS.ratingSource) &&
            'source not trimmed or too long',
        ].filter(Boolean);
        expect({ title: movie.title, problems }).toEqual({ title: movie.title, problems: [] });
      }
    },
  );
});
