import type { OpenAPIObject } from '@nestjs/swagger';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { buildOpenApiDocument } from '../../../../src/common/swagger/openapi-document';
import type { MovieShowtimesResponse } from '../../../../src/modules/discovery/dto/movie-showtimes.response';
import type { PublicShowtimeResponse } from '../../../../src/modules/discovery/dto/public-showtime.response';
import type { TheaterShowtimesResponse } from '../../../../src/modules/discovery/dto/theater-showtimes.response';
import { expectStatus } from '../../../support/catalog';
import { TestClock } from '../../../support/clock';
import { countQueries, toJsonSchema } from '../../../support/discovery';
import {
  WORLD_FROM_PRICES,
  WORLD_NOW,
  buildShowtimeWorld,
} from '../../../support/discovery-showtimes';
import { scheduleShowtime } from '../../../support/showtimes';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { DEFAULT_PRICES } from '../../../support/theaters';
import type { ShowtimeWorld, StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(240_000);

const API = '/api/v1';

describe('The public showtime lists', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let world: ShowtimeWorld;
  let document: OpenAPIObject;
  const clock = new TestClock(WORLD_NOW);

  const get = (path: string) => testApp.http().get(`${API}${path}`);
  const ok = async <T>(path: string): Promise<T> => expectStatus(await get(path), 200).body as T;
  const chipIds = (showtimes: readonly PublicShowtimeResponse[]): number[] =>
    showtimes.map((showtime) => showtime.id);

  /** Validates a response against a schema of the generated contract. */
  const validateAgainst = (name: string, body: unknown) => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile({
      definitions: toJsonSchema(document.components?.schemas) as Record<string, object>,
      $ref: `#/definitions/${name}`,
    });
    return { valid: validate(body), errors: validate.errors ?? [] };
  };

  beforeAll(async () => {
    testApp = await createTestApp({ clock });
    admin = await staffSession(testApp, 'admin');
    world = await buildShowtimeWorld(testApp, admin, clock);
    document = buildOpenApiDocument(testApp.app);
  });

  afterEach(() => clock.set(WORLD_NOW));

  afterAll(async () => {
    await testApp.close();
  });

  describe('GET /movies/{id}/showtimes', () => {
    it('lists 7 cinema days from today, theaters by name, the 00:30 show under the day before', async () => {
      const body = await ok<MovieShowtimesResponse>(`/movies/${world.movies.lighthouse}/showtimes`);
      const { showtimes: ids, theaters } = world;
      expect(body.movieId).toBe(world.movies.lighthouse);
      expect(body.cinemaDate).toBe('2026-10-16');
      expect(body.days.map((day) => day.cinemaDate)).toEqual([
        '2026-10-16',
        '2026-10-17',
        '2026-10-18',
        '2026-10-19',
        '2026-10-20',
        '2026-10-21',
        '2026-10-22',
      ]);
      const [friday, saturday] = body.days;
      expect(friday!.theaters.map((group) => [group.theater.id, chipIds(group.showtimes)])).toEqual(
        [
          // Ended (13:00), cancelled, draft- and paused-theater showtimes are left out.
          [theaters.downtown, [ids.dLighthouse]],
          [theaters.zamalek, [ids.zStarted, ids.zEvening, ids.zAfterMidnight]],
        ],
      );
      expect(friday!.showtimeCount).toBe(4);
      expect(saturday!.theaters.map((group) => chipIds(group.showtimes))).toEqual([
        [ids.dTomorrow],
      ]);
      expect(body.days[6]!.theaters.map((group) => chipIds(group.showtimes))).toEqual([
        [ids.zLastDay],
      ]);
      // Today + 7 (the 23rd) is outside the window; the days between are empty.
      expect(body.days.slice(2, 6).every((day) => day.theaters.length === 0)).toBe(true);
      expect(body.theaters).toEqual([
        {
          id: theaters.downtown,
          name: 'maqady Downtown',
          district: 'Downtown',
          city: 'Cairo',
          showtimeCount: 2,
        },
        {
          id: theaters.zamalek,
          name: 'Maqady Zamalek',
          district: 'Zamalek',
          city: 'Cairo',
          showtimeCount: 4,
        },
      ]);
    });

    it('gives each chip its times, hall, zone prices and from price, and whether it started', async () => {
      const body = await ok<MovieShowtimesResponse>(`/movies/${world.movies.lighthouse}/showtimes`);
      const zamalek = body.days[0]!.theaters[1]!.showtimes;
      expect(zamalek[0]).toEqual({
        id: world.showtimes.zStarted,
        startsAt: '2026-10-16T17:00:00+03:00',
        endsAt: '2026-10-16T18:40:00+03:00',
        cinemaDate: '2026-10-16',
        hall: { id: world.halls.zamalek, name: expect.any(String) },
        prices: DEFAULT_PRICES,
        fromPrice: WORLD_FROM_PRICES.zamalek,
        hasStarted: true,
      });
      expect(zamalek.map((chip) => chip.hasStarted)).toEqual([true, false, false]);
      expect(zamalek[2]).toMatchObject({
        startsAt: '2026-10-17T00:30:00+03:00',
        cinemaDate: '2026-10-16',
      });
      // Downtown's hall has no front rows, so its "from" price is the middle zone's.
      expect(body.days[0]!.theaters[0]!.showtimes[0]).toMatchObject({
        hall: { id: world.halls.downtown, name: 'Hall 2' },
        fromPrice: WORLD_FROM_PRICES.downtown,
      });
      expect(validateAgainst('MovieShowtimes', body)).toEqual({ valid: true, errors: [] });
    });

    it('moves with the Clock: after midnight the 00:30 show is still on the 16th, then it ends', async () => {
      clock.set(new Date('2026-10-17T00:40:00+03:00'));
      const running = await ok<MovieShowtimesResponse>(
        `/movies/${world.movies.lighthouse}/showtimes`,
      );
      expect(running.cinemaDate).toBe('2026-10-16');
      const zamalek = running.days[0]!.theaters.find(
        (group) => group.theater.id === world.theaters.zamalek,
      )!;
      expect(zamalek.showtimes.map((chip) => [chip.id, chip.hasStarted])).toEqual([
        [world.showtimes.zAfterMidnight, true],
      ]);

      clock.set(new Date('2026-10-17T06:30:00+03:00'));
      const nextDay = await ok<MovieShowtimesResponse>(
        `/movies/${world.movies.lighthouse}/showtimes`,
      );
      expect(nextDay.cinemaDate).toBe('2026-10-17');
      expect(nextDay.days[0]!.theaters.map((group) => chipIds(group.showtimes))).toEqual([
        [world.showtimes.dTomorrow],
      ]);
      // The 23rd is now inside the 7 days.
      expect(chipIds(nextDay.days[6]!.theaters[0]!.showtimes)).toEqual([world.showtimes.zTooFar]);
    });

    it('answers a Coming soon movie with 7 empty days', async () => {
      const body = await ok<MovieShowtimesResponse>(`/movies/${world.movies.comingSoon}/showtimes`);
      expect(body.days).toHaveLength(7);
      expect(body.days.every((day) => day.showtimeCount === 0 && day.theaters.length === 0)).toBe(
        true,
      );
      expect(body.theaters).toEqual([]);
    });

    it('is NOT_FOUND for a draft, an archived or an unknown movie, and 400 for a bad id', async () => {
      for (const id of [world.movies.draft, world.movies.archived, 999999]) {
        const response = await get(`/movies/${id}/showtimes`);
        expect({ id, status: response.status, code: response.body.error.code }).toEqual({
          id,
          status: 404,
          code: 'NOT_FOUND',
        });
        expect(response.headers['cache-control']).toBe('no-store');
      }
      expect((await get('/movies/abc/showtimes')).status).toBe(400);
    });

    it('needs no token, and may be cached for a minute', async () => {
      const response = await get(`/movies/${world.movies.lighthouse}/showtimes`);
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('public, max-age=60');
    });
  });

  describe('GET /theaters/{id}/showtimes', () => {
    it('lists the 7 cinema days, movies by their first showtime, only Now showing movies', async () => {
      const body = await ok<TheaterShowtimesResponse>(
        `/theaters/${world.theaters.downtown}/showtimes`,
      );
      const { movies, showtimes: ids } = world;
      expect(body).toMatchObject({ theaterId: world.theaters.downtown, cinemaDate: '2026-10-16' });
      expect(body.days).toHaveLength(7);
      expect(
        body.days[0]!.movies.map((group) => [group.movie.id, chipIds(group.showtimes)]),
      ).toEqual([
        // Started Only is running (17:30–18:30); the archived movie's 23:00 show is left out.
        [movies.startedOnly, [ids.dStarted]],
        [movies.nile, [ids.dNile]],
        [movies.lighthouse, [ids.dLighthouse]],
      ]);
      expect(body.days[0]!.movies[0]!.showtimes[0]!.hasStarted).toBe(true);
      expect(body.days[0]!.movies[1]!.movie).toMatchObject({
        id: movies.nile,
        title: 'Nile Hours',
        status: 'now_showing',
        runtimeMinutes: 60,
      });
      expect(body.days[1]!.movies.map((group) => group.movie.id)).toEqual([movies.lighthouse]);
      expect(validateAgainst('TheaterShowtimes', body)).toEqual({ valid: true, errors: [] });
    });

    it('lists the 00:30 show under the previous cinema date, and a cancelled one never', async () => {
      const body = await ok<TheaterShowtimesResponse>(
        `/theaters/${world.theaters.zamalek}/showtimes?date=2026-10-16`,
      );
      expect(body.days).toHaveLength(1);
      expect(body.days[0]!.cinemaDate).toBe('2026-10-16');
      expect(
        body.days[0]!.movies.map((group) => [group.movie.id, chipIds(group.showtimes)]),
      ).toEqual([
        [
          world.movies.lighthouse,
          [world.showtimes.zStarted, world.showtimes.zEvening, world.showtimes.zAfterMidnight],
        ],
      ]);
      const saturday = await ok<TheaterShowtimesResponse>(
        `/theaters/${world.theaters.zamalek}/showtimes?date=2026-10-17`,
      );
      expect(saturday.days[0]!.movies.map((group) => group.movie.id)).toEqual([
        world.movies.tomorrowOnly,
      ]);
    });

    it('answers a date outside the 7 days with no movies, even when it has showtimes', async () => {
      for (const date of ['2026-10-15', '2026-10-23']) {
        const body = await ok<TheaterShowtimesResponse>(
          `/theaters/${world.theaters.zamalek}/showtimes?date=${date}`,
        );
        expect(body.days).toEqual([{ cinemaDate: date, movies: [] }]);
      }
    });

    it('refuses a malformed date with VALIDATION_FAILED on date', async () => {
      for (const date of ['2026-02-30', 'today', '16-10-2026']) {
        const response = await get(`/theaters/${world.theaters.zamalek}/showtimes?date=${date}`);
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
        expect(response.body.error.details.fields[0].field).toBe('date');
      }
    });

    it('is NOT_FOUND for a draft, a paused or an unknown theater', async () => {
      for (const id of [world.theaters.draft, world.theaters.paused, 999999]) {
        const response = await get(`/theaters/${id}/showtimes`);
        expect({ id, status: response.status, code: response.body.error.code }).toEqual({
          id,
          status: 404,
          code: 'NOT_FOUND',
        });
      }
    });
  });

  describe('query cost', () => {
    it('costs the same number of queries for a few showtimes and for many more', async () => {
      const moviePath = `/movies/${world.movies.lighthouse}/showtimes`;
      const theaterPath = `/theaters/${world.theaters.zamalek}/showtimes`;
      const movieBefore = await countQueries(testApp, () => get(moviePath));
      const theaterBefore = await countQueries(testApp, () => get(theaterPath));

      clock.set(new Date('2026-10-16T09:00:00+03:00'));
      for (const date of ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21']) {
        await scheduleShowtime(
          testApp,
          admin,
          { movieId: world.movies.lighthouse, hallId: world.halls.zamalek },
          date,
          '15:00',
        );
        await scheduleShowtime(
          testApp,
          admin,
          { movieId: world.movies.nile, hallId: world.halls.downtown },
          date,
          '15:00',
        );
      }
      clock.set(WORLD_NOW);
      const movieAfter = await countQueries(testApp, () => get(moviePath));
      const theaterAfter = await countQueries(testApp, () => get(theaterPath));
      expect(movieAfter).toBe(movieBefore);
      expect(theaterAfter).toBe(theaterBefore);
      const lighthouse = await ok<MovieShowtimesResponse>(moviePath);
      expect(
        lighthouse.theaters.find((row) => row.id === world.theaters.zamalek)!.showtimeCount,
      ).toBe(8);
    });
  });
});
