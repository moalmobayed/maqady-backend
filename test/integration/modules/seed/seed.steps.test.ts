import type { AddressInfo } from 'node:net';
import { SeedApiClient } from '../../../../src/modules/seed/seed-api.client';
import { SEED_STEPS } from '../../../../src/modules/seed/seed.steps';
import type { SeedContext, SeedMovie, SeedTheater } from '../../../../src/modules/seed/types';
import { createStaffMember } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { theaterBody } from '../../../support/theaters';
import type { TestApp } from '../../../support/types';

jest.setTimeout(120_000);

/** Draft movies with no pictures, videos or credits: the step only creates and patches them. */
function seedMovie(title: string, overrides: Partial<SeedMovie> = {}): SeedMovie {
  return {
    title,
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

const RATED = seedMovie('Rated by the seed', { rating: 8.4, ratingSource: 'elCinema users' });
const SCORE_ONLY = seedMovie('Score only', { rating: 6 });
const UNRATED = seedMovie('Never rated');

describe('the seed movies step and the rating score (#29), over HTTP with real wiring', () => {
  let testApp: TestApp;
  let api: SeedApiClient;
  const moviesStep = SEED_STEPS.find((step) => step.name === 'movies')!;

  const run = (movies: readonly SeedMovie[]) => {
    const context: SeedContext = {
      api,
      dataset: { name: 'test', theaters: [], people: [], movies, showtimes: [] },
      today: '2026-11-13',
      theaterIds: new Map(),
      hallIds: new Map(),
      personIds: new Map(),
      movieIds: new Map(),
    };
    return moviesStep.run(context);
  };
  const ratings = () =>
    testApp
      .knex('movies')
      .select<{ title: string; rating: number | null; rating_source: string | null }[]>(
        'title',
        'rating',
        'rating_source',
      )
      .orderBy('title');

  beforeAll(async () => {
    testApp = await createTestApp();
    await testApp.app.listen(0, '127.0.0.1');
    const { port } = testApp.app.getHttpServer().address() as AddressInfo;
    const admin = await createStaffMember(testApp, { role: 'admin' });
    api = new SeedApiClient(`http://127.0.0.1:${port}/api/v1`);
    await api.signIn(admin.email, admin.password);
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('creates the movies with their scores, and none for a movie without one', async () => {
    expect(await run([RATED, SCORE_ONLY, UNRATED])).toEqual({ created: 3, kept: 0 });
    expect(await ratings()).toEqual([
      { title: 'Never rated', rating: null, rating_source: null },
      { title: 'Rated by the seed', rating: 8.4, rating_source: 'elCinema users' },
      { title: 'Score only', rating: 6, rating_source: null },
    ]);
  });

  it('back-fills the scores of movies seeded before they had one, and keeps an edited score', async () => {
    // As on staging: the movies exist from an earlier seed without scores.
    await testApp.knex('movies').update({ rating: null, rating_source: null });
    // An admin scored this one since; the seed leaves it alone.
    await testApp.knex('movies').update({ rating: 5.5 }).where({ title: 'Score only' });

    expect(await run([RATED, SCORE_ONLY, UNRATED])).toEqual({ created: 0, kept: 3 });
    expect(await ratings()).toEqual([
      { title: 'Never rated', rating: null, rating_source: null },
      { title: 'Rated by the seed', rating: 8.4, rating_source: 'elCinema users' },
      { title: 'Score only', rating: 5.5, rating_source: null },
    ]);
    const updates = await testApp
      .knex('audit_events')
      .select<{ changed_fields: string[] }[]>('changed_fields')
      .where({ action: 'movie.updated' });
    expect(updates.map((row) => row.changed_fields)).toEqual([['rating', 'ratingSource']]);
  });
});

describe('the seed halls step and the hall format and screen (#29 P4), over HTTP with real wiring', () => {
  let testApp: TestApp;
  let api: SeedApiClient;
  let theaterId: number;
  const hallsStep = SEED_STEPS.find((step) => step.name === 'halls')!;
  const THEATER = 'Maqady Seed Halls';

  const run = (halls: SeedTheater['halls']) => {
    const theater = { name: THEATER, publish: true, halls } as SeedTheater;
    const context: SeedContext = {
      api,
      dataset: { name: 'test', theaters: [theater], people: [], movies: [], showtimes: [] },
      today: '2026-11-13',
      theaterIds: new Map([[THEATER, theaterId]]),
      hallIds: new Map(),
      personIds: new Map(),
      movieIds: new Map(),
    };
    return hallsStep.run(context);
  };
  const halls = () =>
    testApp
      .knex('halls')
      .select('name', 'status', 'format', 'screen_width_cm', 'screen_height_cm')
      .orderBy('name');

  beforeAll(async () => {
    testApp = await createTestApp();
    await testApp.app.listen(0, '127.0.0.1');
    const { port } = testApp.app.getHttpServer().address() as AddressInfo;
    const admin = await createStaffMember(testApp, { role: 'admin' });
    api = new SeedApiClient(`http://127.0.0.1:${port}/api/v1`);
    await api.signIn(admin.email, admin.password);
    theaterId = (
      await api.write<{ id: number }>('POST', '/admin/theaters', theaterBody({ name: THEATER }))
    ).id;
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('creates halls with their format and screen, and a name-only hall as a standard one', async () => {
    const result = await run([
      { name: 'Hall 1', format: 'dolby_atmos', screenWidthMeters: 22.1, screenHeightMeters: 12.3 },
      'Hall 2',
    ]);
    expect(result).toEqual({ created: 2, kept: 0 });
    expect(await halls()).toEqual([
      {
        name: 'Hall 1',
        status: 'active',
        format: 'dolby_atmos',
        screen_width_cm: 2210,
        screen_height_cm: 1230,
      },
      {
        name: 'Hall 2',
        status: 'active',
        format: 'standard',
        screen_width_cm: null,
        screen_height_cm: null,
      },
    ]);
  });

  it('fills a hall seeded before #29, and keeps a hall an admin changed', async () => {
    // As on staging: both halls exist from an earlier seed at the defaults...
    await testApp
      .knex('halls')
      .update({ format: 'standard', screen_width_cm: null, screen_height_cm: null });
    // ...and an admin has since made Hall 2 a VIP hall.
    await testApp.knex('halls').update({ format: 'vip' }).where({ name: 'Hall 2' });

    const result = await run([
      { name: 'Hall 1', format: 'imax', screenWidthMeters: 26.5, screenHeightMeters: 14 },
      { name: 'Hall 2', format: '4dx' },
    ]);
    expect(result).toEqual({ created: 0, kept: 2 });
    expect(await halls()).toEqual([
      {
        name: 'Hall 1',
        status: 'active',
        format: 'imax',
        screen_width_cm: 2650,
        screen_height_cm: 1400,
      },
      {
        name: 'Hall 2',
        status: 'active',
        format: 'vip',
        screen_width_cm: null,
        screen_height_cm: null,
      },
    ]);
    const updates = await testApp
      .knex('audit_events')
      .select<{ changed_fields: string[] }[]>('changed_fields')
      .where({ action: 'hall.updated' });
    expect(updates.map((row) => row.changed_fields)).toEqual([
      ['format', 'screenHeightMeters', 'screenWidthMeters'],
    ]);
  });
});
