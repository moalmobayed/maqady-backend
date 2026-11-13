import { MAX_MOVIE_RATING, TEXT_LIMITS } from '../../../../src/modules/catalog/catalog.constants';
import {
  PHONE_NUMBER_PATTERN,
  POSTAL_CODE_PATTERN,
} from '../../../../src/modules/theaters/theaters.constants';
import { SEED_DATASETS } from '../../../../src/modules/seed/datasets';
import { AppError } from '../../../../src/common/errors/app-error';
import { createValidationPipe } from '../../../../src/common/errors/validation';
import { CreateHallRequest } from '../../../../src/modules/halls/dto/create-hall.request';
import { SEED_STEPS, seedHallOf } from '../../../../src/modules/seed/seed.steps';
import type {
  SeedAdminMovie,
  SeedAdminTheater,
  SeedApi,
  SeedContext,
  SeedHall,
  SeedHallRow,
  SeedMovie,
  SeedTheater,
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

/** A draft dataset theater whose children are all already stored, so the step only creates and patches. */
function seedTheater(overrides: Partial<SeedTheater> = {}): SeedTheater {
  return {
    name: 'Maqady Zamalek',
    address: '26 July Street',
    district: 'Zamalek',
    city: 'Cairo',
    latitude: 30.0609,
    longitude: 31.2197,
    transitInfo: null,
    parkingInfo: null,
    email: null,
    showContactsPublic: true,
    phones: [],
    facilities: [],
    hours: [],
    specialDate: null,
    galleryCaptions: [],
    publish: false,
    colour: '#1f4e79',
    coverUrl: null,
    ...overrides,
  };
}

function adminTheater(overrides: Partial<SeedAdminTheater> = {}): SeedAdminTheater {
  return {
    id: 7,
    status: 'draft',
    postalCode: null,
    whatsapp: null,
    phones: [{}],
    facilities: ['cafe_bar'],
    hours: [{}],
    specialDates: [],
    defaultPrices: {},
    cover: null,
    photos: [{}],
    ...overrides,
  };
}

/** The admin API as the `theaters` step sees it: `existing` theaters, and `/admin/theaters/7`. */
function fakeTheaterApi(
  existing: readonly { id: number; name: string }[],
  stored: SeedAdminTheater,
) {
  const writes: Write[] = [];
  const api: SeedApi = {
    get: <T>(path: string): Promise<T> => {
      const route = path.split('?')[0];
      if (route === '/admin/theaters') {
        return Promise.resolve({ items: existing, nextCursor: null } as T);
      }
      if (route === '/admin/theaters/7') return Promise.resolve(stored as T);
      return Promise.reject(new Error(`unexpected GET ${path}`));
    },
    write: <T>(method: SeedWriteMethod, path: string, body: unknown): Promise<T> => {
      writes.push({ method, path, body: body as Record<string, unknown> });
      return Promise.resolve({ id: 7 } as T);
    },
    upload: () => Promise.reject(new Error('unexpected upload')),
  };
  return { api, writes };
}

function theaterContext(api: SeedApi, theaters: readonly SeedTheater[]): SeedContext {
  return {
    ...context(api, []),
    dataset: { name: 'test', theaters, people: [], movies: [], showtimes: [] },
  };
}

const theatersStep = SEED_STEPS.find((step) => step.name === 'theaters')!;

describe('the seed theaters step: postal code and WhatsApp (#29)', () => {
  it('sends both when it creates a theater', async () => {
    const { api, writes } = fakeTheaterApi(
      [],
      adminTheater({ postalCode: '11211', whatsapp: '+201001234567' }),
    );
    await theatersStep.run(
      theaterContext(api, [seedTheater({ postalCode: '11211', whatsapp: '+201001234567' })]),
    );
    expect(writes).toEqual([
      {
        method: 'POST',
        path: '/admin/theaters',
        body: expect.objectContaining({ postalCode: '11211', whatsapp: '+201001234567' }),
      },
    ]);
  });

  it('back-fills both on a theater seeded before it had them, with one PATCH', async () => {
    const { api, writes } = fakeTheaterApi([{ id: 7, name: 'Maqady Zamalek' }], adminTheater());
    await theatersStep.run(
      theaterContext(api, [seedTheater({ postalCode: '11211', whatsapp: '+201001234567' })]),
    );
    expect(writes).toEqual([
      {
        method: 'PATCH',
        path: '/admin/theaters/7',
        body: { postalCode: '11211', whatsapp: '+201001234567' },
      },
    ]);
  });

  it('back-fills only the missing one, and never overwrites a value an admin set', async () => {
    const { api, writes } = fakeTheaterApi(
      [{ id: 7, name: 'Maqady Zamalek' }],
      adminTheater({ postalCode: '12611', whatsapp: null }),
    );
    await theatersStep.run(
      theaterContext(api, [seedTheater({ postalCode: '11211', whatsapp: '+201001234567' })]),
    );
    expect(writes.map((write) => write.body)).toEqual([{ whatsapp: '+201001234567' }]);

    const both = fakeTheaterApi(
      [{ id: 7, name: 'Maqady Zamalek' }],
      adminTheater({ postalCode: '12611', whatsapp: '+201009999999' }),
    );
    await theatersStep.run(
      theaterContext(both.api, [seedTheater({ postalCode: '11211', whatsapp: '+201001234567' })]),
    );
    expect(both.writes).toEqual([]);
  });

  it('sends neither for a dataset theater without them', async () => {
    const created = fakeTheaterApi([], adminTheater());
    await theatersStep.run(theaterContext(created.api, [seedTheater()]));
    expect(created.writes).toHaveLength(1);
    expect(created.writes[0]!.body).not.toHaveProperty('postalCode');
    expect(created.writes[0]!.body).not.toHaveProperty('whatsapp');

    const existing = fakeTheaterApi([{ id: 7, name: 'Maqady Zamalek' }], adminTheater());
    await theatersStep.run(theaterContext(existing.api, [seedTheater({ postalCode: null })]));
    expect(existing.writes).toEqual([]);
  });

  it.each(Object.values(SEED_DATASETS).map((dataset) => [dataset.name, dataset] as const))(
    'the %s dataset gives only postal codes and WhatsApp numbers the admin API accepts',
    (_name, dataset) => {
      for (const theater of dataset.theaters) {
        const problems = [
          typeof theater.postalCode === 'string' &&
            !POSTAL_CODE_PATTERN.test(theater.postalCode) &&
            'postal code not 5 digits',
          typeof theater.whatsapp === 'string' &&
            !PHONE_NUMBER_PATTERN.test(theater.whatsapp) &&
            'WhatsApp number not E.164',
        ].filter(Boolean);
        expect({ name: theater.name, problems }).toEqual({ name: theater.name, problems: [] });
      }
    },
  );
});

describe('the seed halls step: format and screen size (#29 P4)', () => {
  const hallsStep = SEED_STEPS.find((step) => step.name === 'halls')!;

  function hallRow(overrides: Partial<SeedHallRow> = {}): SeedHallRow {
    return {
      id: 61,
      name: 'Hall 1',
      status: 'active',
      format: 'standard',
      screenWidthMeters: null,
      screenHeightMeters: null,
      ...overrides,
    };
  }

  function theater(halls: SeedTheater['halls']): SeedTheater {
    return { name: 'Maqady Zamalek', publish: true, halls } as SeedTheater;
  }

  /** The admin API as the `halls` step sees it: theater 3 lists `existing`; writes recorded. */
  function hallsApi(existing: readonly SeedHallRow[]) {
    const writes: Write[] = [];
    const api: SeedApi = {
      get: <T>(path: string): Promise<T> =>
        path.split('?')[0] === '/admin/theaters/3/halls'
          ? Promise.resolve({ items: existing, nextCursor: null } as T)
          : Promise.reject(new Error(`unexpected GET ${path}`)),
      write: <T>(method: SeedWriteMethod, path: string, body: unknown): Promise<T> => {
        writes.push({ method, path, body: body as Record<string, unknown> });
        return Promise.resolve(hallRow({ id: 62, status: 'draft' }) as T);
      },
      upload: () => Promise.reject(new Error('unexpected upload')),
    };
    return { api, writes };
  }

  async function run(api: SeedApi, halls: SeedTheater['halls']) {
    const ctx: SeedContext = {
      ...context(api, []),
      dataset: { name: 'test', theaters: [theater(halls)], people: [], movies: [], showtimes: [] },
      theaterIds: new Map([['Maqady Zamalek', 3]]),
    };
    const result = await hallsStep.run(ctx);
    return { result, hallIds: ctx.hallIds };
  }

  const ATMOS: SeedHall = {
    name: 'Hall 2',
    format: 'dolby_atmos',
    screenWidthMeters: 22.1,
    screenHeightMeters: 12.3,
  };

  it('sends the format and screen when it creates a hall, then activates it', async () => {
    const { api, writes } = hallsApi([]);
    const { result, hallIds } = await run(api, [ATMOS]);
    expect(result).toEqual({ created: 1, kept: 0 });
    expect(writes).toEqual([
      {
        method: 'POST',
        path: '/admin/theaters/3/halls',
        body: {
          name: 'Hall 2',
          format: 'dolby_atmos',
          screenWidthMeters: 22.1,
          screenHeightMeters: 12.3,
        },
      },
      { method: 'PATCH', path: '/admin/halls/62', body: { status: 'active' } },
    ]);
    expect(hallIds.get('Maqady Zamalek|Hall 2')).toBe(62);
  });

  it('creates a hall given by its name alone exactly as before: { name }', async () => {
    const { api, writes } = hallsApi([]);
    await run(api, ['Hall 1']);
    expect(writes[0]!.body).toEqual({ name: 'Hall 1' });
  });

  it('fills an existing active hall still at the defaults with one PATCH', async () => {
    const { api, writes } = hallsApi([hallRow({ id: 61, name: 'Hall 2' })]);
    const { result } = await run(api, [ATMOS]);
    expect(result).toEqual({ created: 0, kept: 1 });
    expect(writes).toEqual([
      {
        method: 'PATCH',
        path: '/admin/halls/61',
        body: { format: 'dolby_atmos', screenWidthMeters: 22.1, screenHeightMeters: 12.3 },
      },
    ]);
  });

  it('fills and activates an existing draft hall in the same PATCH', async () => {
    const { api, writes } = hallsApi([hallRow({ name: 'Hall 2', status: 'draft' })]);
    await run(api, [{ name: 'Hall 2', format: 'vip' }]);
    expect(writes.map((write) => write.body)).toEqual([{ format: 'vip', status: 'active' }]);
  });

  it('leaves alone a hall an admin already changed, and a name-only hall', async () => {
    const { api, writes } = hallsApi([
      hallRow({ name: 'Hall 2', format: 'imax' }),
      hallRow({ id: 63, name: 'Hall 3', screenWidthMeters: 18, screenHeightMeters: 9 }),
      hallRow({ id: 64, name: 'Hall 4' }),
    ]);
    const { result } = await run(api, [ATMOS, { ...ATMOS, name: 'Hall 3' }, 'Hall 4']);
    expect(result).toEqual({ created: 0, kept: 3 });
    expect(writes).toEqual([]);
  });

  it('sends no PATCH on a re-run for a hall the dataset names as standard without a screen', async () => {
    const { api, writes } = hallsApi([hallRow({ name: 'Hall 5' })]);
    const { result } = await run(api, [{ name: 'Hall 5', format: 'standard' }]);
    expect(result).toEqual({ created: 0, kept: 1 });
    expect(writes).toEqual([]);
  });

  it('back-fills only the non-default values: a standard hall gets its screen alone', async () => {
    const { api, writes } = hallsApi([hallRow({ name: 'Hall 6' })]);
    await run(api, [
      { name: 'Hall 6', format: 'standard', screenWidthMeters: 14, screenHeightMeters: 6.2 },
    ]);
    expect(writes.map((write) => write.body)).toEqual([
      { screenWidthMeters: 14, screenHeightMeters: 6.2 },
    ]);
  });

  it.each(Object.values(SEED_DATASETS).map((dataset) => [dataset.name, dataset] as const))(
    'the %s dataset gives only hall formats and screen sizes the admin API accepts',
    async (_name, dataset) => {
      for (const seedTheater of dataset.theaters) {
        for (const entry of seedTheater.halls ?? []) {
          const { name, ...spec } = seedHallOf(entry);
          const fields = await invalidHallFields({ name, ...spec });
          expect({ hall: `${seedTheater.name} ${name}`, fields }).toEqual({
            hall: `${seedTheater.name} ${name}`,
            fields: [],
          });
        }
      }
    },
  );
});

/** The fields `POST /admin/theaters/{id}/halls` would refuse in this body. */
async function invalidHallFields(body: Record<string, unknown>): Promise<string[]> {
  try {
    await createValidationPipe().transform(body, {
      type: 'body',
      metatype: CreateHallRequest,
      data: '',
    });
    return [];
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return (error.details as { fields: { field: string }[] }).fields.map((entry) => entry.field);
  }
}
