import type { MovieCardPageResponse } from '../../../../src/modules/discovery/dto/movie-lists.response';
import {
  adminWrite,
  createDraftMovie,
  createPerson,
  createPublishedMovie,
  expectStatus,
  genreId,
  idsOf,
} from '../../../support/catalog';
import { countQueries } from '../../../support/discovery';
import { mediaDirectory, removeMediaDirectory } from '../../../support/media';
import { jpeg } from '../../../support/media-fixtures';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { buildTestConfig } from '../../../support/test-config';
import type { StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(240_000);

const API = '/api/v1';

/** Every genre seeded by `0070_01`, alphabetical: the facet lists them all, in this order. */
const GENRE_SLUGS = [
  'action',
  'adventure',
  'animation',
  'comedy',
  'drama',
  'family',
  'mystery',
  'romance',
  'sci-fi',
  'thriller',
];

/**
 * `GET /movies` facets (#29) through the real routes and real Postgres: genre counts, the cast
 * and their counts over every matching movie, never only the page, each facet without its own
 * filter. The show-date counts need showtimes: `movie-facets-showtimes.test.ts`.
 *
 * Now showing: Alpha (action, drama: Karim and Hala acting, Dalia directing), Bravo (action:
 * Karim, Mona as a voice), Charlie (comedy: Hala), Delta (comedy, drama: Karim), Echo (drama, no
 * cast). Coming soon: Foxtrot (action: Samir). Never counted: a draft (drama: Nadia) and an
 * archived movie (action, comedy: Omar).
 */
describe('The Movies page facets', () => {
  let directory: string;
  let testApp: TestApp;
  let admin: StaffSession;
  const movie = { alpha: 0, bravo: 0, charlie: 0, delta: 0, echo: 0, foxtrot: 0 };
  const person = { karim: 0, hala: 0, mona: 0, dalia: 0, samir: 0, nadia: 0, omar: 0 };

  const get = (path: string) => testApp.http().get(`${API}${path}`);
  const ok = async <T>(path: string): Promise<T> => expectStatus(await get(path), 200).body as T;
  const list = (query = '') => ok<MovieCardPageResponse>(`/movies${query}`);

  /** Every page of a query, two movies at a time. */
  const allPages = async (query: string): Promise<MovieCardPageResponse[]> => {
    const pages = [await list(`?limit=2${query}`)];
    while (pages.at(-1)!.nextCursor !== null) {
      pages.push(await list(`?limit=2${query}&cursor=${pages.at(-1)!.nextCursor}`));
    }
    return pages;
  };

  /** The genre facet as `slug: count`, every genre included. */
  const genreCounts = (body: MovieCardPageResponse): Record<string, number> =>
    Object.fromEntries(body.facets.genres.map((genre) => [genre.slug, genre.count]));

  /** The counts with these non-zero genres, every other genre 0. */
  const expectedGenres = (counts: Record<string, number>): Record<string, number> =>
    Object.fromEntries(GENRE_SLUGS.map((slug) => [slug, counts[slug] ?? 0]));

  const people = (body: MovieCardPageResponse) =>
    body.facets.people.map((entry) => ({ id: entry.id, count: entry.count }));

  const named = async (fullName: string): Promise<number> =>
    (await createPerson(testApp, admin, { fullName })).id;

  const credit = async (movieId: number, credits: Record<string, unknown>[]): Promise<void> => {
    expectStatus(
      await adminWrite(testApp, admin, 'put', `${API}/admin/movies/${movieId}/credits`).send({
        credits,
      }),
      200,
    );
  };

  beforeAll(async () => {
    directory = await mediaDirectory();
    testApp = await createTestApp({
      config: buildTestConfig({}, { LOCAL_STORAGE_DIR: directory }),
    });
    admin = await staffSession(testApp, 'admin');
    person.karim = await named('Karim Fahmy');
    person.hala = await named('Hala Ezzat');
    person.mona = await named('Mona Zaki');
    person.dalia = await named('Dalia Nour');
    person.samir = await named('Samir Adel');
    person.nadia = await named('Nadia Draft');
    person.omar = await named('Omar Archived');
    expectStatus(
      await testApp
        .http()
        .put(`${API}/admin/people/${person.karim}/photo`)
        .set('Authorization', admin.authorization)
        .attach('file', await jpeg(600, 600, '#335577'), 'karim.jpg'),
      200,
    );

    const published = async (title: string, releaseDate: string, genres: string[]) =>
      (await createPublishedMovie(testApp, admin, { title, releaseDate, genres })).id;
    movie.alpha = await published('Alpha', '2026-10-05', ['action', 'drama']);
    movie.bravo = await published('Bravo', '2026-10-04', ['action']);
    movie.charlie = await published('Charlie', '2026-10-03', ['comedy']);
    movie.delta = await published('Delta', '2026-10-02', ['comedy', 'drama']);
    movie.echo = await published('Echo', '2026-10-01', ['drama']);
    movie.foxtrot = (
      await createPublishedMovie(testApp, admin, {
        title: 'Foxtrot',
        status: 'coming_soon',
        releaseDate: '2026-12-01',
        genres: ['action'],
      })
    ).id;
    const draft = (
      await createDraftMovie(testApp, admin, {
        title: 'Hidden Draft',
        genreIds: [await genreId(testApp, 'drama')],
      })
    ).id;
    const archived = await published('Gone Archived', '2026-09-01', ['action', 'comedy']);

    await credit(movie.alpha, [
      { personId: person.karim, role: 'actor', characterName: 'Youssef' },
      { personId: person.hala, role: 'actor' },
      { personId: person.dalia, role: 'director' },
    ]);
    await credit(movie.bravo, [
      { personId: person.karim, role: 'actor' },
      { personId: person.mona, role: 'voice' },
    ]);
    await credit(movie.charlie, [{ personId: person.hala, role: 'actor' }]);
    await credit(movie.delta, [
      { personId: person.karim, role: 'actor' },
      // A second role on the same movie still counts the movie once.
      { personId: person.karim, role: 'voice' },
    ]);
    await credit(movie.foxtrot, [{ personId: person.samir, role: 'actor' }]);
    await credit(draft, [{ personId: person.nadia, role: 'actor' }]);
    await credit(archived, [{ personId: person.omar, role: 'actor' }]);
    expectStatus(
      await adminWrite(testApp, admin, 'patch', `${API}/admin/movies/${archived}`).send({
        status: 'archived',
      }),
      200,
    );
  });

  afterAll(async () => {
    await testApp.close();
    await removeMediaDirectory(directory);
  });

  describe('genres', () => {
    it('counts every matching movie per genre across pages, the same on every page', async () => {
      const pages = await allPages('');
      expect(pages).toHaveLength(3);
      const listed = pages.flatMap((page) => page.items);
      expect(idsOf(listed)).toEqual([
        movie.alpha,
        movie.bravo,
        movie.charlie,
        movie.delta,
        movie.echo,
      ]);
      // What the pages hold, counted by hand, is what the facet says; every page says it.
      const fromItems: Record<string, number> = {};
      for (const item of listed) {
        for (const genre of item.genres) fromItems[genre.slug] = (fromItems[genre.slug] ?? 0) + 1;
      }
      for (const page of pages) expect(genreCounts(page)).toEqual(expectedGenres(fromItems));
      expect(genreCounts(pages[0]!)).toEqual(expectedGenres({ action: 2, comedy: 2, drama: 3 }));
    });

    it('lists every genre alphabetically with its id, name and slug', async () => {
      const body = await list();
      expect(body.facets.genres.map((genre) => genre.slug)).toEqual(GENRE_SLUGS);
      expect(body.facets.genres[0]).toEqual({
        id: await genreId(testApp, 'action'),
        name: 'Action',
        slug: 'action',
        count: 2,
      });
    });

    it('ignores the genre filter, so the other genres keep their counts', async () => {
      const body = await list('?genres=action');
      expect(idsOf(body.items)).toEqual([movie.alpha, movie.bravo]);
      expect(genreCounts(body)).toEqual(expectedGenres({ action: 2, comedy: 2, drama: 3 }));
    });

    it('follows the other filters: people, q and the tab', async () => {
      expect(genreCounts(await list(`?people=${person.karim}`))).toEqual(
        expectedGenres({ action: 2, comedy: 1, drama: 2 }),
      );
      expect(genreCounts(await list('?q=alpha'))).toEqual(expectedGenres({ action: 1, drama: 1 }));
      // The archived movie (action, comedy) never counts, in either tab.
      expect(genreCounts(await list('?status=coming_soon'))).toEqual(expectedGenres({ action: 1 }));
      expect(genreCounts(await list('?q=nothing-matches'))).toEqual(expectedGenres({}));
    });
  });

  describe('people', () => {
    it('lists the cast of the matching movies, most movies first, then by name', async () => {
      const body = await list('?limit=1');
      // Dalia only directs; Nadia (draft), Omar (archived) and Samir (Coming soon) don't match.
      expect(people(body)).toEqual([
        { id: person.karim, count: 3 },
        { id: person.hala, count: 2 },
        { id: person.mona, count: 1 },
      ]);
      expect(body.facets.peopleTotal).toBe(3);
      expect(body.facets.people[1]).toEqual({
        id: person.hala,
        fullName: 'Hala Ezzat',
        photo: null,
        count: 2,
      });
      expect(body.facets.people[0]!.photo).toMatchObject({
        alt: 'Karim Fahmy',
        variants: expect.arrayContaining([
          expect.objectContaining({ url: expect.stringMatching(/^http/) }),
        ]),
      });
    });

    it('is narrowed by a genre filter', async () => {
      const action = await list('?genres=action');
      expect(people(action)).toEqual([
        { id: person.karim, count: 2 },
        { id: person.hala, count: 1 },
        { id: person.mona, count: 1 },
      ]);
      expect(people(await list('?genres=comedy'))).toEqual([
        { id: person.hala, count: 1 },
        { id: person.karim, count: 1 },
      ]);
    });

    it('ignores the people filter, so the other cast members stay selectable', async () => {
      const body = await list(`?people=${person.mona}`);
      expect(idsOf(body.items)).toEqual([movie.bravo]);
      expect(people(body)).toEqual([
        { id: person.karim, count: 3 },
        { id: person.hala, count: 2 },
        { id: person.mona, count: 1 },
      ]);
      // ...while the genres follow it.
      expect(genreCounts(body)).toEqual(expectedGenres({ action: 1 }));
    });

    it('follows the tab and is empty when nothing matches', async () => {
      expect(people(await list('?status=coming_soon'))).toEqual([{ id: person.samir, count: 1 }]);
      const none = await list('?q=nothing-matches');
      expect(none.facets.people).toEqual([]);
      expect(none.facets.peopleTotal).toBe(0);
    });
  });

  describe('showDates without showtimes', () => {
    it('lists the three options with 0 when nothing is scheduled', async () => {
      const body = await list();
      expect(body.facets.showDates.map((option) => [option.value, option.count])).toEqual([
        ['today', 0],
        ['tomorrow', 0],
        ['weekend', 0],
      ]);
      for (const option of body.facets.showDates) {
        expect(option.cinemaDates.length).toBeGreaterThan(0);
        for (const date of option.cinemaDates) expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });
  });

  describe('the cap', () => {
    const ensemble: number[] = [];

    beforeAll(async () => {
      for (let index = 1; index <= 32; index += 1) {
        ensemble.push(await named(`Ensemble ${String(index).padStart(2, '0')}`));
      }
      const id = (
        await createPublishedMovie(testApp, admin, {
          title: 'Ensemble Piece',
          releaseDate: '2026-09-15',
          genres: ['thriller'],
        })
      ).id;
      await credit(
        id,
        ensemble.map((personId) => ({ personId, role: 'actor' })),
      );
    });

    it('lists at most 30 cast members and says how many there are', async () => {
      const thriller = await list('?genres=thriller');
      expect(thriller.facets.people).toHaveLength(30);
      expect(thriller.facets.peopleTotal).toBe(32);
      expect(thriller.facets.people.map((entry) => entry.id)).toEqual(ensemble.slice(0, 30));

      // Unfiltered: Karim and Hala first, then 28 of the 33 people in one movie, by name.
      const all = await list();
      expect(all.facets.peopleTotal).toBe(35);
      expect(people(all)).toEqual([
        { id: person.karim, count: 3 },
        { id: person.hala, count: 2 },
        ...ensemble.slice(0, 28).map((id) => ({ id, count: 1 })),
      ]);
    });
  });

  describe('query cost', () => {
    it('does not grow with the number of movies, people or genres matched', async () => {
      const queries = ['?limit=2', `?genres=action,drama&people=${person.karim}`, '?q=ha&limit=50'];
      const before = [];
      for (const query of queries) before.push(await countQueries(testApp, () => list(query)));

      for (let index = 0; index < 12; index += 1) {
        const id = (
          await createPublishedMovie(testApp, admin, {
            title: `Another ${index}`,
            releaseDate: '2026-08-01',
            genres: ['action', 'drama', 'family'],
          })
        ).id;
        await credit(id, [
          { personId: person.karim, role: 'actor' },
          { personId: await named(`Extra ${index}`), role: 'actor' },
        ]);
      }
      const after = [];
      for (const query of queries) after.push(await countQueries(testApp, () => list(query)));

      expect(after).toEqual(before);
      // The facets did see the new movies.
      const body = await list();
      expect(genreCounts(body).family).toBe(12);
      expect(people(body)[0]).toEqual({ id: person.karim, count: 15 });
    });
  });
});
