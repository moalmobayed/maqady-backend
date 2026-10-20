import type { AddressInfo } from 'node:net';
import type { HomeResponse } from '../../../../src/modules/discovery/dto/home.response';
import { runSeed } from '../../../../src/modules/seed/seed.command';
import { SEED_ADMIN_EMAIL } from '../../../../src/modules/seed/seed.constants';
import { expectStatus } from '../../../support/catalog';
import { draftValidator } from '../../../support/discovery';
import { mediaDirectory, removeMediaDirectory, storedFiles } from '../../../support/media';
import { createTestApp } from '../../../support/test-app';
import { buildTestConfig } from '../../../support/test-config';
import type { TestApp } from '../../../support/types';

jest.setTimeout(300_000);

const COUNTED_TABLES = [
  'staff_users',
  'theaters',
  'theater_phones',
  'theater_facilities',
  'theater_photos',
  'theater_hours',
  'theater_special_dates',
  'people',
  'person_roles',
  'movies',
  'movie_genres',
  'movie_photos',
  'movie_videos',
  'movie_credits',
  'images',
] as const;

describe('npm run seed', () => {
  let directory: string;
  let testApp: TestApp;
  let baseUrl: string;

  const counts = async (): Promise<Record<string, number>> => {
    const entries = [];
    for (const table of COUNTED_TABLES) {
      const row = await testApp.knex(table).count<{ count: number }[]>({ count: '*' }).first();
      entries.push([table, row?.count ?? 0] as const);
    }
    return Object.fromEntries(entries);
  };

  beforeAll(async () => {
    directory = await mediaDirectory();
    testApp = await createTestApp({
      config: buildTestConfig({}, { LOCAL_STORAGE_DIR: directory }),
    });
    await testApp.app.listen(0, '127.0.0.1');
    const { port } = testApp.app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;
  });

  afterAll(async () => {
    await testApp.close();
    await removeMediaDirectory(directory);
  });

  it('refuses production before touching anything', async () => {
    await expect(
      runSeed(testApp.app, baseUrl, { NODE_ENV: 'production' }, () => {}),
    ).rejects.toThrow('NODE_ENV is production');
    expect((await counts()).staff_users).toBe(0);
  });

  it('fills an empty database, then runs again without duplicating anything', async () => {
    const first: string[] = [];
    await runSeed(testApp.app, baseUrl, {}, (line) => first.push(line));
    expect(first).toEqual([
      `Created the seed admin ${SEED_ADMIN_EMAIL}.`,
      'theaters: 6 created, 0 already there',
      'publish-theaters: 5 created, 0 already there',
      'people: 18 created, 0 already there',
      'movies: 12 created, 0 already there',
      'featured: 5 created, 0 already there',
      `Done. Sign in to the dashboard as ${SEED_ADMIN_EMAIL}.`,
    ]);
    const afterFirst = await counts();
    expect(afterFirst).toMatchObject({
      staff_users: 1,
      theaters: 6,
      people: 18,
      movies: 12,
      movie_videos: 24,
    });
    // Covers, gallery photos, people photos, posters and stills, all through the pipeline.
    expect(afterFirst.images).toBe(6 + 6 + 18 + 12 + 20);
    expect((await storedFiles(directory)).length).toBe(afterFirst.images! * 3);

    const second: string[] = [];
    await runSeed(testApp.app, baseUrl, {}, (line) => second.push(line));
    expect(second).toEqual([
      'theaters: 0 created, 6 already there',
      'publish-theaters: 0 created, 5 already there',
      'people: 0 created, 18 already there',
      'movies: 0 created, 12 already there',
      'featured: 0 created, 5 already there',
      `Done. Sign in to the dashboard as ${SEED_ADMIN_EMAIL}.`,
    ]);
    expect(await counts()).toEqual(afterFirst);
  });

  it('gives the home page what the contract examples show', async () => {
    const body = expectStatus(await testApp.http().get('/api/v1/home'), 200).body as HomeResponse;
    const validate = draftValidator('HomeResponse');
    expect({ valid: validate(body), errors: validate.errors ?? [] }).toEqual({
      valid: true,
      errors: [],
    });
    expect(body.featured.map((slide: { position: number }) => slide.position)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(body.featured[0]!.movie.title).toBe('The Last Lighthouse');
    expect(body.featured.every((slide: { backdrop: unknown }) => slide.backdrop !== null)).toBe(
      true,
    );
    expect(body.nowShowing.total).toBe(7);
    expect(body.comingSoon.total).toBe(4);
    expect(body.cinemas.map((card: { name: string }) => card.name)).toEqual([
      'Maqady Downtown',
      'Maqady Heliopolis',
      'Maqady New Cairo',
      'Maqady Sheikh Zayed',
      'Maqady Zamalek',
    ]);
    const zayed = body.cinemas.find((card) => card.name === 'Maqady Sheikh Zayed')!;
    expect(zayed.mainPhone).toBeNull();
    expect(body.cinemas.every((card: { cover: unknown }) => card.cover !== null)).toBe(true);
    expect(body.genres.find((genre) => genre.slug === 'drama')!.movieCount).toBe(3);
  });
});
