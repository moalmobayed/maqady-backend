import { adminWrite, createDraftMovie, createPublishedMovie, expectStatus } from './catalog';
import type { TestClock } from './clock';
import { HALLS, addActiveHall, createHall, setHallStatus } from './halls';
import { cancelShowtime, scheduleShowtime } from './showtimes';
import { createTheater, everyDay, prepareTheater, setTheaterStatus } from './theaters';
import type { ShowtimeWorld, ShowtimeWorldName, StaffSession, TestApp } from './types';

/**
 * The showtime world of the U8b discovery suites, built through the real admin routes at 09:00
 * on Friday 16 October 2026 (Cairo, `+03:00`); the suites then read it at `WORLD_NOW`, 18:00.
 *
 * - Maqady Zamalek (active, 12:00–03:00, a 12 × 16 hall: from EGP 150) and maqady Downtown
 *   (active, 12:00–01:00, a hall without front rows: from EGP 190); Maqady Draft (a draft) and
 *   Maqady Paused (published, then sales paused), each with a showtime that must never appear.
 * - The Last Lighthouse (100 min) on the 16th at Zamalek 13:00 (ended at 18:00), 17:00
 *   (running), 20:00 and 00:30 after midnight (cinema date 16), at Downtown 21:00; on the 17th
 *   at Downtown; on the 22nd (today + 6) and the 23rd (today + 7, outside the window) at Zamalek.
 * - Nile Hours (60 min) at Downtown 19:30; Archived Reel at Downtown 23:00, then archived;
 *   Tomorrow Only on the 17th; Draft Theater Only at the draft theater; Started Only at Downtown
 *   17:30 (running at 18:00); Cancelled Only at Zamalek 22:00, cancelled; a Coming soon movie
 *   and a draft movie without showtimes.
 */

/** When the world is built: every start is after it. */
export const WORLD_SETUP = new Date('2026-10-16T09:00:00+03:00');

/** When the suites read it: Friday 16 October 2026, 18:00 Cairo time. */
export const WORLD_NOW = new Date('2026-10-16T18:00:00+03:00');

/** The prices every world theater copies onto its showtimes (`DEFAULT_PRICES`). */
export const WORLD_FROM_PRICES = {
  zamalek: { amount: 15000, currency: 'EGP' },
  downtown: { amount: 19000, currency: 'EGP' },
} as const;

export async function buildShowtimeWorld(
  testApp: TestApp,
  admin: StaffSession,
  clock: TestClock,
): Promise<ShowtimeWorld> {
  const auth = admin.authorization;
  clock.set(WORLD_SETUP);

  const theater = async (name: string, district: string, closes: string): Promise<number> => {
    const id = await createTheater(testApp, auth, { name, district });
    await prepareTheater(testApp, auth, id, everyDay('12:00', closes));
    return id;
  };
  const zamalek = await theater('Maqady Zamalek', 'Zamalek', '03:00');
  const zamalekHall = await addActiveHall(testApp, auth, zamalek);
  await setTheaterStatus(testApp, auth, zamalek, 'active');

  const downtown = await theater('maqady Downtown', 'Downtown', '01:00');
  const downtownHall = await createHall(testApp, auth, downtown, 'Hall 2');
  const layout = await testApp
    .http()
    .put(`${HALLS}/${downtownHall}/layout`)
    .set('Authorization', auth)
    .send({
      rowCount: 4,
      seatsPerRow: 8,
      rowZones: ['middle', 'middle', 'back', 'back'],
      seatMarks: [],
    });
  expectStatus(layout, 200);
  await setHallStatus(testApp, auth, downtownHall, 'active');
  await setTheaterStatus(testApp, auth, downtown, 'active');

  const draft = await theater('Maqady Draft', 'Dokki', '01:00');
  const draftHall = await addActiveHall(testApp, auth, draft);
  const paused = await theater('Maqady Paused', 'Maadi', '01:00');
  const pausedHall = await addActiveHall(testApp, auth, paused);
  await setTheaterStatus(testApp, auth, paused, 'active');

  const movie = async (title: string, runtimeMinutes: number): Promise<number> =>
    (await createPublishedMovie(testApp, admin, { title, runtimeMinutes })).id;
  const movies = {
    lighthouse: await movie('The Last Lighthouse', 100),
    nile: await movie('Nile Hours', 60),
    archived: await movie('Archived Reel', 60),
    comingSoon: (
      await createPublishedMovie(testApp, admin, {
        title: 'Desert Signal',
        status: 'coming_soon',
        releaseDate: '2026-11-20',
      })
    ).id,
    tomorrowOnly: await movie('Tomorrow Only', 60),
    draftTheaterOnly: await movie('Draft Theater Only', 60),
    startedOnly: await movie('Started Only', 60),
    cancelledOnly: await movie('Cancelled Only', 60),
    draft: (await createDraftMovie(testApp, admin, { title: 'Still A Draft' })).id,
  };

  const at = async (
    movieId: number,
    hallId: number,
    cinemaDate: string,
    startTime: string,
  ): Promise<number> =>
    (await scheduleShowtime(testApp, admin, { movieId, hallId }, cinemaDate, startTime)).id;
  const { lighthouse } = movies;
  const showtimes: Record<ShowtimeWorldName, number> = {
    zEnded: await at(lighthouse, zamalekHall, '2026-10-16', '13:00'),
    zStarted: await at(lighthouse, zamalekHall, '2026-10-16', '17:00'),
    zEvening: await at(lighthouse, zamalekHall, '2026-10-16', '20:00'),
    zCancelled: await at(movies.cancelledOnly, zamalekHall, '2026-10-16', '22:00'),
    zAfterMidnight: await at(lighthouse, zamalekHall, '2026-10-16', '00:30'),
    zTomorrow: await at(movies.tomorrowOnly, zamalekHall, '2026-10-17', '13:00'),
    zLastDay: await at(lighthouse, zamalekHall, '2026-10-22', '19:00'),
    zTooFar: await at(lighthouse, zamalekHall, '2026-10-23', '19:00'),
    dStarted: await at(movies.startedOnly, downtownHall, '2026-10-16', '17:30'),
    dNile: await at(movies.nile, downtownHall, '2026-10-16', '19:30'),
    dLighthouse: await at(lighthouse, downtownHall, '2026-10-16', '21:00'),
    dArchived: await at(movies.archived, downtownHall, '2026-10-16', '23:00'),
    dTomorrow: await at(lighthouse, downtownHall, '2026-10-17', '19:00'),
    draftLighthouse: await at(lighthouse, draftHall, '2026-10-16', '19:00'),
    draftOnly: await at(movies.draftTheaterOnly, draftHall, '2026-10-16', '21:00'),
    pausedLighthouse: await at(lighthouse, pausedHall, '2026-10-16', '18:30'),
  };
  await cancelShowtime(testApp, admin, showtimes.zCancelled);
  await setTheaterStatus(testApp, auth, paused, 'sales_paused');
  const archive = await adminWrite(
    testApp,
    admin,
    'patch',
    `/api/v1/admin/movies/${movies.archived}`,
  ).send({ status: 'archived' });
  expectStatus(archive, 200);

  clock.set(WORLD_NOW);
  return {
    theaters: { zamalek, downtown, draft, paused },
    halls: { zamalek: zamalekHall, downtown: downtownHall },
    movies,
    showtimes,
  };
}
