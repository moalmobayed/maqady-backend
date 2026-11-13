import type { MovieCardPageResponse } from '../../../../src/modules/discovery/dto/movie-lists.response';
import { adminWrite, expectStatus } from '../../../support/catalog';
import { TestClock } from '../../../support/clock';
import { countQueries } from '../../../support/discovery';
import { WORLD_NOW, buildShowtimeWorld } from '../../../support/discovery-showtimes';
import { scheduleShowtime } from '../../../support/showtimes';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { ShowtimeWorld, StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(240_000);

const API = '/api/v1';

/**
 * The `showDates` facet of `GET /movies` (#29) on the U8b showtime world, read at Friday
 * 16 October 2026, 18:00 Cairo time unless a test moves the Clock. Still to start that evening at
 * the two active theaters: The Last Lighthouse (20:00, 21:00 and 00:30 after midnight) and Nile
 * Hours (19:30); on the 17th Tomorrow Only and The Last Lighthouse; then The Last Lighthouse on
 * the 22nd and the 23rd. Never counted: Started Only (running), Cancelled Only, Draft Theater
 * Only (a draft theater), the paused theater's showtime and Archived Reel (archived).
 */
describe('The Movies page show-date facet', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let world: ShowtimeWorld;
  const clock = new TestClock(WORLD_NOW);

  const get = (path: string) => testApp.http().get(`${API}${path}`);
  const list = async (query = ''): Promise<MovieCardPageResponse> =>
    expectStatus(await get(`/movies${query}`), 200).body as MovieCardPageResponse;

  /** The facet as `[value, count, cinemaDates]`. */
  const showDates = async (query = '') =>
    (await list(query)).facets.showDates.map((option) => [
      option.value,
      option.count,
      option.cinemaDates,
    ]);

  beforeAll(async () => {
    testApp = await createTestApp({ clock });
    admin = await staffSession(testApp, 'admin');
    world = await buildShowtimeWorld(testApp, admin, clock);
  });

  afterEach(() => clock.set(WORLD_NOW));

  afterAll(async () => {
    await testApp.close();
  });

  it('counts the movies still to start on each option at a theater open for sales', async () => {
    expect(await showDates()).toEqual([
      ['today', 2, ['2026-10-16']],
      ['tomorrow', 2, ['2026-10-17']],
      // A Friday: this weekend is today and tomorrow.
      ['weekend', 3, ['2026-10-16', '2026-10-17']],
    ]);
  });

  it('agrees with what the showDate filter lists', async () => {
    const body = await list();
    for (const option of body.facets.showDates) {
      const filtered = await list(`?showDate=${option.value}`);
      expect({ value: option.value, total: filtered.total }).toEqual({
        value: option.value,
        total: option.count,
      });
    }
  });

  it('ignores the showDate filter, but narrows the genre counts by it', async () => {
    const today = await list('?showDate=today');
    expect(today.facets.showDates.map((option) => option.count)).toEqual([2, 2, 3]);
    // Every world movie is a drama: 6 Now showing in all, 2 showing today.
    const drama = (body: MovieCardPageResponse) =>
      body.facets.genres.find((genre) => genre.slug === 'drama')!.count;
    expect(drama(await list())).toBe(6);
    expect(drama(today)).toBe(2);
    expect(drama(await list('?showDate=tomorrow'))).toBe(2);
  });

  it('follows the other filters', async () => {
    expect((await showDates('?q=nile')).map(([, count]) => count)).toEqual([1, 0, 1]);
    expect((await showDates('?q=tomorrow')).map(([, count]) => count)).toEqual([0, 1, 1]);
    expect((await showDates('?genres=action')).map(([, count]) => count)).toEqual([0, 0, 0]);
  });

  it('is 0 on the Coming soon tab, which has no show date filter', async () => {
    expect(await showDates('?status=coming_soon')).toEqual([
      ['today', 0, ['2026-10-16']],
      ['tomorrow', 0, ['2026-10-17']],
      ['weekend', 0, ['2026-10-16', '2026-10-17']],
    ]);
  });

  it('stays 0 on Coming soon for a movie brought back from archived with a showtime left', async () => {
    // Archiving keeps the movie's showtimes and an archived movie may return to Coming soon:
    // Archived Reel still has its 23:00 show tonight at an active theater.
    const setStatus = async (status: string) =>
      expectStatus(
        await adminWrite(
          testApp,
          admin,
          'patch',
          `${API}/admin/movies/${world.movies.archived}`,
        ).send({ status }),
        200,
      );
    await setStatus('coming_soon');
    try {
      const body = await list('?status=coming_soon');
      expect(body.items.map((item) => item.id)).toContain(world.movies.archived);
      expect(body.facets.showDates.map((option) => option.count)).toEqual([0, 0, 0]);
    } finally {
      await setStatus('archived');
    }
  });

  it("keeps an after-midnight showtime in its cinema date's count until it starts", async () => {
    // 00:20 on Saturday is still Friday's cinema day: the 00:30 show is today's, not tomorrow's.
    clock.set(new Date('2026-10-17T00:20:00+03:00'));
    expect(await showDates()).toEqual([
      ['today', 1, ['2026-10-16']],
      ['tomorrow', 2, ['2026-10-17']],
      ['weekend', 2, ['2026-10-16', '2026-10-17']],
    ]);
    clock.set(new Date('2026-10-17T00:35:00+03:00'));
    expect((await showDates()).map(([, count]) => count)).toEqual([0, 2, 2]);
  });

  it('makes the weekend today only on a Saturday, and the coming Friday and Saturday on a Sunday', async () => {
    clock.set(new Date('2026-10-17T12:00:00+03:00'));
    expect(await showDates()).toEqual([
      ['today', 2, ['2026-10-17']],
      ['tomorrow', 0, ['2026-10-18']],
      ['weekend', 2, ['2026-10-17']],
    ]);
    // Sunday: the weekend is the 23rd and 24th, where The Last Lighthouse plays on the 23rd.
    clock.set(new Date('2026-10-18T12:00:00+03:00'));
    expect(await showDates()).toEqual([
      ['today', 0, ['2026-10-18']],
      ['tomorrow', 0, ['2026-10-19']],
      ['weekend', 1, ['2026-10-23', '2026-10-24']],
    ]);
  });

  it('costs the same number of queries however many showtimes there are', async () => {
    const before = await countQueries(testApp, () => list('?limit=2'));
    clock.set(new Date('2026-10-16T09:00:00+03:00'));
    for (const startTime of ['15:00', '17:00']) {
      await scheduleShowtime(
        testApp,
        admin,
        { movieId: world.movies.nile, hallId: world.halls.zamalek },
        '2026-10-17',
        startTime,
      );
    }
    clock.set(WORLD_NOW);
    const after = await countQueries(testApp, () => list('?limit=2'));
    expect(after).toBe(before);
    expect((await showDates()).map(([, count]) => count)).toEqual([2, 3, 3]);
  });
});
