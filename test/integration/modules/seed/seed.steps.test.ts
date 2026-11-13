import type { AddressInfo } from 'node:net';
import { SeedApiClient } from '../../../../src/modules/seed/seed-api.client';
import { SEED_STEPS } from '../../../../src/modules/seed/seed.steps';
import type { SeedContext, SeedMovie, SeedTheater } from '../../../../src/modules/seed/types';
import { createStaffMember } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
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

/** Draft theaters with hours and nothing else to upload: the step creates, patches and sets hours and prices. */
function seedTheater(name: string, overrides: Partial<SeedTheater> = {}): SeedTheater {
  return {
    name,
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
    hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      closed: false,
      opens: '12:00',
      closes: '01:00',
    })),
    specialDate: null,
    galleryCaptions: [],
    publish: false,
    colour: '#1f4e79',
    coverUrl: null,
    ...overrides,
  };
}

const WITH_BOTH = seedTheater('Maqady Zamalek', {
  postalCode: '11211',
  whatsapp: '+201001234567',
});
const POSTAL_ONLY = seedTheater('Maqady Giza', { postalCode: '12611' });
const WITHOUT = seedTheater('Maqady Maadi');

describe('the seed theaters step and the #29 theater fields, over HTTP with real wiring', () => {
  let testApp: TestApp;
  let api: SeedApiClient;
  const theatersStep = SEED_STEPS.find((step) => step.name === 'theaters')!;

  const run = (theaters: readonly SeedTheater[]) => {
    const context: SeedContext = {
      api,
      dataset: { name: 'test', theaters, people: [], movies: [], showtimes: [] },
      today: '2026-11-13',
      theaterIds: new Map(),
      hallIds: new Map(),
      personIds: new Map(),
      movieIds: new Map(),
    };
    return theatersStep.run(context);
  };
  const stored = () =>
    testApp
      .knex('theaters')
      .select<{ name: string; postal_code: string | null; whatsapp: string | null }[]>(
        'name',
        'postal_code',
        'whatsapp',
      )
      .orderBy('name');

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

  it('creates the theaters with their postal codes and WhatsApp numbers, none when absent', async () => {
    expect(await run([WITH_BOTH, POSTAL_ONLY, WITHOUT])).toEqual({ created: 3, kept: 0 });
    expect(await stored()).toEqual([
      { name: 'Maqady Giza', postal_code: '12611', whatsapp: null },
      { name: 'Maqady Maadi', postal_code: null, whatsapp: null },
      { name: 'Maqady Zamalek', postal_code: '11211', whatsapp: '+201001234567' },
    ]);
  });

  it('back-fills theaters seeded before they had them, and keeps a value an admin set', async () => {
    // As on staging: the theaters exist from an earlier seed without these fields.
    await testApp.knex('theaters').update({ postal_code: null, whatsapp: null });
    // An admin set this one's postal code since; the seed leaves it alone.
    await testApp.knex('theaters').update({ postal_code: '12655' }).where({ name: 'Maqady Giza' });
    await testApp.knex('audit_events').where({ action: 'theater.updated' }).delete();

    expect(await run([WITH_BOTH, POSTAL_ONLY, WITHOUT])).toEqual({ created: 0, kept: 3 });
    expect(await stored()).toEqual([
      { name: 'Maqady Giza', postal_code: '12655', whatsapp: null },
      { name: 'Maqady Maadi', postal_code: null, whatsapp: null },
      { name: 'Maqady Zamalek', postal_code: '11211', whatsapp: '+201001234567' },
    ]);
    const updates = await testApp
      .knex('audit_events')
      .select<{ changed_fields: string[] }[]>('changed_fields')
      .where({ action: 'theater.updated' });
    expect(updates.map((row) => row.changed_fields)).toEqual([['postalCode', 'whatsapp']]);
  });
});
