import type { AddressInfo } from 'node:net';
import type { HomeResponse } from '../../../../src/modules/discovery/dto/home.response';
import type { TheaterShowtimesResponse } from '../../../../src/modules/discovery/dto/theater-showtimes.response';
import { runRemoteSeed, runSeed } from '../../../../src/modules/seed/seed.command';
import {
  DEFAULT_SEED_ADMIN_PASSWORD,
  SEED_ADMIN_EMAIL,
} from '../../../../src/modules/seed/seed.constants';
import { expectStatus } from '../../../support/catalog';
import { TestClock } from '../../../support/clock';
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
  'halls',
  'people',
  'person_roles',
  'movies',
  'movie_genres',
  'movie_photos',
  'movie_videos',
  'movie_credits',
  'images',
  'showtimes',
] as const;

/**
 * Thursday 22 October 2026, 10:00 Cairo time: every slot of today is still ahead, and the 7
 * cinema dates hold the late Thursday and Friday nights of Downtown and New Cairo.
 */
const SEED_NOW = new Date('2026-10-22T10:00:00+03:00');

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
      clock: new TestClock(SEED_NOW),
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
      'Dataset: demo',
      'theaters: 6 created, 0 already there',
      'halls: 5 created, 0 already there',
      'publish-theaters: 5 created, 0 already there',
      'people: 18 created, 0 already there',
      'movies: 12 created, 0 already there',
      'featured: 5 created, 0 already there',
      // 4 slots × 5 theaters × 7 days, and 2 after-midnight slots on Thursday and Friday.
      'showtimes: 144 created, 0 already there',
      `Done. Sign in to the dashboard as ${SEED_ADMIN_EMAIL}.`,
    ]);
    const afterFirst = await counts();
    expect(afterFirst).toMatchObject({
      staff_users: 1,
      theaters: 6,
      halls: 5,
      people: 18,
      movies: 12,
      movie_videos: 24,
      showtimes: 144,
    });
    // Covers, gallery photos, people photos, posters and stills, all through the pipeline.
    expect(afterFirst.images).toBe(6 + 6 + 18 + 12 + 20);
    expect((await storedFiles(directory)).length).toBe(afterFirst.images! * 3);

    const second: string[] = [];
    await runSeed(testApp.app, baseUrl, {}, (line) => second.push(line));
    expect(second).toEqual([
      'Dataset: demo',
      'theaters: 0 created, 6 already there',
      'halls: 0 created, 5 already there',
      'publish-theaters: 0 created, 5 already there',
      'people: 0 created, 18 already there',
      'movies: 0 created, 12 already there',
      'featured: 0 created, 5 already there',
      'showtimes: 0 created, 144 already there',
      `Done. Sign in to the dashboard as ${SEED_ADMIN_EMAIL}.`,
    ]);
    expect(await counts()).toEqual(afterFirst);
  });

  it('seeds through a running server over HTTP with seed:remote, finding everything already there', async () => {
    const before = await counts();
    const lines: string[] = [];
    await runRemoteSeed(
      {
        SEED_API_URL: `${baseUrl}/`,
        SEED_ADMIN_EMAIL: SEED_ADMIN_EMAIL,
        SEED_ADMIN_PASSWORD: DEFAULT_SEED_ADMIN_PASSWORD,
      },
      (line) => lines.push(line),
    );
    // The server's cinema date (from GET /home, on the test Clock) picks the same 7 days.
    expect(lines).toEqual([
      'Dataset: demo',
      'theaters: 0 created, 6 already there',
      'halls: 0 created, 5 already there',
      'publish-theaters: 0 created, 5 already there',
      'people: 0 created, 18 already there',
      'movies: 0 created, 12 already there',
      'featured: 0 created, 5 already there',
      'showtimes: 0 created, 144 already there',
      'Done.',
    ]);
    expect(await counts()).toEqual(before);
  });

  it('refuses a wrong admin password with the sign-in error code only', async () => {
    await expect(
      runRemoteSeed(
        {
          SEED_API_URL: baseUrl,
          SEED_ADMIN_EMAIL: SEED_ADMIN_EMAIL,
          SEED_ADMIN_PASSWORD: 'Wrong-passw0rd',
        },
        () => {},
      ),
    ).rejects.toThrow('Seed: POST /admin/auth/sessions answered 401 INVALID_CREDENTIALS');
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
    expect(body.cinemas.every((card) => card.hallCount === 1)).toBe(true);
    // Every Now showing movie has a showtime still ahead today, the first ones at 13:30.
    expect(body.ticker).toHaveLength(7);
    expect(body.ticker[0]!.nextShowtime).toMatchObject({
      startsAt: '2026-10-22T13:30:00+03:00',
      cinemaDate: '2026-10-22',
    });
  });

  it('schedules the after-midnight slots only on the late Thursday and Friday nights', async () => {
    const rows = await testApp
      .knex('showtimes as s')
      .join('theaters as t', 't.id', 's.theater_id')
      .select<{ name: string; cinema_date: string }[]>('t.name', 's.cinema_date')
      .whereRaw("(s.starts_at AT TIME ZONE 'Africa/Cairo')::time < '06:00'")
      .orderBy([{ column: 's.cinema_date' }, { column: 't.name' }]);
    expect(rows.map((row) => `${row.cinema_date} ${row.name}`)).toEqual([
      '2026-10-22 Maqady Downtown',
      '2026-10-22 Maqady New Cairo',
      '2026-10-23 Maqady Downtown',
      '2026-10-23 Maqady New Cairo',
    ]);
    const theaters = expectStatus(await testApp.http().get('/api/v1/theaters'), 200).body.items as {
      id: number;
      name: string;
    }[];
    const downtown = theaters.find((item) => item.name === 'Maqady Downtown')!;
    const showtimes = expectStatus(
      await testApp.http().get(`/api/v1/theaters/${downtown.id}/showtimes?date=2026-10-22`),
      200,
    ).body as TheaterShowtimesResponse;
    const late = showtimes.days[0]!.movies.flatMap((movie) => movie.showtimes).find(
      (showtime) => showtime.startsAt === '2026-10-23T00:15:00+03:00',
    );
    expect(late).toMatchObject({ cinemaDate: '2026-10-22' });
  });
});
