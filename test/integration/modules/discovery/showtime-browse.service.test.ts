import type { MovieDetailsResponse } from '../../../../src/modules/discovery/dto/movie-details.response';
import type { MovieCardPageResponse } from '../../../../src/modules/discovery/dto/movie-lists.response';
import { expectStatus, idsOf } from '../../../support/catalog';
import { TestClock } from '../../../support/clock';
import {
  WORLD_FROM_PRICES,
  WORLD_NOW,
  buildShowtimeWorld,
} from '../../../support/discovery-showtimes';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { ShowtimeWorld, StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(240_000);

const API = '/api/v1';

/**
 * What `ShowtimeBrowseService` adds to the U8a reads, through the real routes: the movie page's
 * side panel and the Movies page "show date" filter.
 */
describe('The showtime parts of the movie reads', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let world: ShowtimeWorld;
  const clock = new TestClock(WORLD_NOW);

  const get = (path: string) => testApp.http().get(`${API}${path}`);
  const ok = async <T>(path: string): Promise<T> => expectStatus(await get(path), 200).body as T;

  beforeAll(async () => {
    testApp = await createTestApp({ clock });
    admin = await staffSession(testApp, 'admin');
    world = await buildShowtimeWorld(testApp, admin, clock);
  });

  afterEach(() => clock.set(WORLD_NOW));

  afterAll(async () => {
    await testApp.close();
  });

  describe('GET /movies/{id} side panel', () => {
    it('gives the next show today, the cinemas and the lowest from price of what is still to start', async () => {
      const body = await ok<MovieDetailsResponse>(`/movies/${world.movies.lighthouse}`);
      expect(body.showtimeSummary).toEqual({
        nextShowToday: {
          id: world.showtimes.zEvening,
          startsAt: '2026-10-16T20:00:00+03:00',
          cinemaDate: '2026-10-16',
          theater: {
            id: world.theaters.zamalek,
            name: 'Maqady Zamalek',
            district: 'Zamalek',
            city: 'Cairo',
          },
          hall: { id: world.halls.zamalek, name: expect.any(String) },
          fromPrice: WORLD_FROM_PRICES.zamalek,
        },
        // Zamalek and Downtown; the draft and paused theaters don't count.
        cinemaCount: 2,
        fromPrice: WORLD_FROM_PRICES.zamalek,
      });
    });

    it('drops what has started: late at night only Downtown is left, at its from price', async () => {
      clock.set(new Date('2026-10-17T00:40:00+03:00'));
      const late = await ok<MovieDetailsResponse>(`/movies/${world.movies.lighthouse}`);
      // Zamalek's 00:30 has started; the 17th at Downtown and the 22nd at Zamalek are left, but
      // nothing more today.
      expect(late.showtimeSummary).toEqual({
        nextShowToday: null,
        cinemaCount: 2,
        fromPrice: WORLD_FROM_PRICES.zamalek,
      });

      clock.set(new Date('2026-10-17T19:30:00+03:00'));
      const saturday = await ok<MovieDetailsResponse>(`/movies/${world.movies.lighthouse}`);
      // Only the 22nd at Zamalek remains within the 7 days (the 23rd is now in them too).
      expect(saturday.showtimeSummary).toMatchObject({ nextShowToday: null, cinemaCount: 1 });
    });

    it('is empty for a Coming soon movie and a movie whose only showtime has started', async () => {
      const empty = { nextShowToday: null, cinemaCount: 0, fromPrice: null };
      for (const id of [
        world.movies.comingSoon,
        world.movies.startedOnly,
        world.movies.cancelledOnly,
      ]) {
        const body = await ok<MovieDetailsResponse>(`/movies/${id}`);
        expect({ id, summary: body.showtimeSummary }).toEqual({ id, summary: empty });
      }
    });

    it('keeps the movie page 404 for a draft or archived movie', async () => {
      for (const id of [world.movies.draft, world.movies.archived]) {
        expect((await get(`/movies/${id}`)).status).toBe(404);
      }
    });
  });

  describe('GET /movies?showDate=', () => {
    const list = (query: string) => ok<MovieCardPageResponse>(`/movies?${query}`);

    it('keeps the movies with a showtime still to start today at a theater open for sales', async () => {
      const body = await list('showDate=today');
      // Not Started Only (running), Cancelled Only, Draft Theater Only, Tomorrow Only.
      expect(idsOf(body.items).sort((a, b) => a - b)).toEqual(
        [world.movies.lighthouse, world.movies.nile].sort((a, b) => a - b),
      );
      expect(body.total).toBe(2);
      // The Coming soon tab has no show date filter, so its count ignores it.
      expect(body.tabCounts).toEqual({ nowShowing: 2, comingSoon: 1 });
    });

    it('takes tomorrow and this weekend (Friday and Saturday)', async () => {
      const tomorrow = await list('showDate=tomorrow');
      expect(idsOf(tomorrow.items).sort((a, b) => a - b)).toEqual(
        [world.movies.lighthouse, world.movies.tomorrowOnly].sort((a, b) => a - b),
      );
      const weekend = await list('showDate=weekend');
      expect(idsOf(weekend.items).sort((a, b) => a - b)).toEqual(
        [world.movies.lighthouse, world.movies.nile, world.movies.tomorrowOnly].sort(
          (a, b) => a - b,
        ),
      );
      // Any: every Now showing movie, with or without showtimes.
      expect((await list('status=now_showing')).total).toBe(6);
    });

    it('combines with the other filters and pages', async () => {
      const page = await list('showDate=weekend&q=lighthouse');
      expect(idsOf(page.items)).toEqual([world.movies.lighthouse]);
      const first = await list('showDate=weekend&limit=2');
      expect(first.items).toHaveLength(2);
      const second = await list(`showDate=weekend&limit=2&cursor=${first.nextCursor}`);
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
      expect(new Set([...idsOf(first.items), ...idsOf(second.items)]).size).toBe(3);
    });

    it('matches nothing once the night is over', async () => {
      clock.set(new Date('2026-10-17T00:35:00+03:00'));
      const body = await list('showDate=today');
      expect(body.items).toEqual([]);
      expect(body.tabCounts.nowShowing).toBe(0);
    });

    it('refuses a show date on the Coming soon tab and an unknown value', async () => {
      for (const query of ['status=coming_soon&showDate=today', 'showDate=sunday']) {
        const response = await get(`/movies?${query}`);
        expect({ query, status: response.status, code: response.body.error.code }).toEqual({
          query,
          status: 400,
          code: 'VALIDATION_FAILED',
        });
        expect(response.body.error.details.fields.map((f: { field: string }) => f.field)).toEqual([
          'showDate',
        ]);
      }
    });
  });
});
