import type { HomeResponse } from '../../../../src/modules/discovery/dto/home.response';
import { HomeTickerSource } from '../../../../src/modules/discovery/home-ticker.source';
import { cinemaDateOf } from '../../../../src/common/time/time';
import { expectStatus } from '../../../support/catalog';
import { TestClock } from '../../../support/clock';
import { countQueries, draftValidator } from '../../../support/discovery';
import { WORLD_NOW, buildShowtimeWorld } from '../../../support/discovery-showtimes';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { ShowtimeWorld, StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(240_000);

const HOME = '/api/v1/home';

describe('The home page ticker (showtimes)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let world: ShowtimeWorld;
  const clock = new TestClock(WORLD_NOW);

  const home = async (): Promise<HomeResponse> =>
    expectStatus(await testApp.http().get(HOME), 200).body as HomeResponse;

  beforeAll(async () => {
    testApp = await createTestApp({ clock });
    admin = await staffSession(testApp, 'admin');
    world = await buildShowtimeWorld(testApp, admin, clock);
  });

  afterEach(() => clock.set(WORLD_NOW));

  afterAll(async () => {
    await testApp.close();
  });

  it('shows each Now showing movie with a showtime still ahead today, its next one, soonest first', async () => {
    const body = await home();
    expect(body.cinemaDate).toBe('2026-10-16');
    expect(body.ticker).toEqual([
      {
        movie: { id: world.movies.nile, title: 'Nile Hours' },
        nextShowtime: {
          id: world.showtimes.dNile,
          startsAt: '2026-10-16T19:30:00+03:00',
          cinemaDate: '2026-10-16',
          theater: { id: world.theaters.downtown, name: 'maqady Downtown' },
        },
      },
      {
        // Its 17:00 show has started and the draft (19:00) and paused (18:30) theaters' don't
        // count, so its next bookable showtime is Zamalek at 20:00.
        movie: { id: world.movies.lighthouse, title: 'The Last Lighthouse' },
        nextShowtime: {
          id: world.showtimes.zEvening,
          startsAt: '2026-10-16T20:00:00+03:00',
          cinemaDate: '2026-10-16',
          theater: { id: world.theaters.zamalek, name: 'Maqady Zamalek' },
        },
      },
    ]);
    // Left out: Started Only (running), Cancelled Only, Tomorrow Only, Draft Theater Only, the
    // archived movie and the Coming soon one.
  });

  it('validates every item against TickerItem, and the whole page against HomeResponse, of the draft', async () => {
    const body = await home();
    expect(body.ticker.length).toBeGreaterThan(0);
    const item = draftValidator('TickerItem');
    for (const entry of body.ticker) {
      expect({ valid: item(entry), errors: item.errors ?? [] }).toEqual({
        valid: true,
        errors: [],
      });
    }
    const page = draftValidator('HomeResponse');
    expect({ valid: page(body), errors: page.errors ?? [] }).toEqual({ valid: true, errors: [] });
  });

  it('keeps the cinema day after midnight: at 00:10 the 00:30 show is still "today"', async () => {
    clock.set(new Date('2026-10-17T00:10:00+03:00'));
    const body = await home();
    expect(body.cinemaDate).toBe('2026-10-16');
    expect(body.ticker).toEqual([
      {
        movie: { id: world.movies.lighthouse, title: 'The Last Lighthouse' },
        nextShowtime: {
          id: world.showtimes.zAfterMidnight,
          startsAt: '2026-10-17T00:30:00+03:00',
          cinemaDate: '2026-10-16',
          theater: { id: world.theaters.zamalek, name: 'Maqady Zamalek' },
        },
      },
    ]);
  });

  it("moves to the next cinema day at 06:00, and empties once the day's last show has started", async () => {
    clock.set(new Date('2026-10-17T00:30:00+03:00'));
    expect((await home()).ticker).toEqual([]);

    clock.set(new Date('2026-10-17T06:00:00+03:00'));
    const saturday = await home();
    expect(saturday.cinemaDate).toBe('2026-10-17');
    expect(
      saturday.ticker.map((entry) => [
        entry.movie.id,
        entry.nextShowtime.id,
        entry.nextShowtime.startsAt,
      ]),
    ).toEqual([
      [world.movies.tomorrowOnly, world.showtimes.zTomorrow, '2026-10-17T13:00:00+03:00'],
      [world.movies.lighthouse, world.showtimes.dTomorrow, '2026-10-17T19:00:00+03:00'],
    ]);
  });

  it('is what the source answers for the same instant, read in a fixed number of queries', async () => {
    const source = testApp.app.get(HomeTickerSource);
    const direct = await source.tickerFor(WORLD_NOW, cinemaDateOf(WORLD_NOW));
    expect(direct.map((entry) => entry.nextShowtime.id)).toEqual([
      world.showtimes.dNile,
      world.showtimes.zEvening,
    ]);
    const today = await countQueries(testApp, () =>
      source.tickerFor(WORLD_NOW, cinemaDateOf(WORLD_NOW)),
    );
    const saturdayMorning = new Date('2026-10-17T06:00:00+03:00');
    const saturday = await countQueries(testApp, () =>
      source.tickerFor(saturdayMorning, cinemaDateOf(saturdayMorning)),
    );
    expect(saturday).toBe(today);
  });

  it('counts the active halls on the cinema cards', async () => {
    const body = await home();
    expect(body.cinemas.map((card) => [card.id, card.hallCount])).toEqual([
      [world.theaters.downtown, 1],
      [world.theaters.zamalek, 1],
    ]);
  });
});
