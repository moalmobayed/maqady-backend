import type { Response } from 'supertest';
import {
  adminWrite,
  createDraftMovie,
  createPerson,
  createPublishedMovie,
  expectStatus,
} from '../../../support/catalog';
import { countQueries, uploadPoster } from '../../../support/discovery';
import { mediaDirectory, removeMediaDirectory } from '../../../support/media';
import { groupIds, searchPublic, theaterWithStatus } from '../../../support/search';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { buildTestConfig } from '../../../support/test-config';
import type { StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(180_000);

const API = '/api/v1';

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

/**
 * `GET /search` (design §13.2; PRD "Search results"): published movies by title or cast, the
 * people credited on them and active theaters by name or district, ranked, typo-tolerant, never
 * a draft or an inactive theater. Real app and Postgres; images on the local storage driver.
 */
describe('GET /search (integration)', () => {
  let directory: string;
  let testApp: TestApp;
  let admin: StaffSession;
  const movie = {
    inception: 0,
    point: 0,
    files: 0,
    kira: 0,
    interception: 0,
    draft: 0,
    archived: 0,
  };
  const person = { helmy: 0, mona: 0, hidden: 0, uncredited: 0 };
  const theater = { nile: 0, galaxy: 0, maadiStars: 0, draft: 0, paused: 0 };

  const ok = async (q: string): Promise<Response> =>
    expectStatus(await searchPublic(testApp, q), 200);

  async function credit(movieId: number, credits: Record<string, unknown>[]): Promise<void> {
    expectStatus(
      await adminWrite(testApp, admin, 'put', `${API}/admin/movies/${movieId}/credits`).send({
        credits,
      }),
      200,
    );
  }

  beforeAll(async () => {
    directory = await mediaDirectory();
    testApp = await createTestApp({
      config: buildTestConfig({}, { LOCAL_STORAGE_DIR: directory }),
    });
    admin = await staffSession(testApp, 'admin');

    person.helmy = (
      await createPerson(testApp, admin, { fullName: 'Ahmed Helmy', roles: ['actor'] })
    ).id;
    person.mona = (await createPerson(testApp, admin, { fullName: 'Mona Zaki' })).id;
    person.hidden = (await createPerson(testApp, admin, { fullName: 'Ahmed Hidden' })).id;
    person.uncredited = (await createPerson(testApp, admin, { fullName: 'Ahmed Nobody' })).id;

    movie.inception = (await createPublishedMovie(testApp, admin, { title: 'Inception' })).id;
    movie.point = (
      await createPublishedMovie(testApp, admin, {
        title: 'Inception Point',
        status: 'coming_soon',
      })
    ).id;
    movie.files = (await createPublishedMovie(testApp, admin, { title: 'The Inception Files' })).id;
    movie.kira = (await createPublishedMovie(testApp, admin, { title: 'Kira' })).id;
    movie.interception = (await createPublishedMovie(testApp, admin, { title: 'Interception' })).id;
    movie.draft = (await createDraftMovie(testApp, admin, { title: 'Inception Helmy Draft' })).id;
    movie.archived = (
      await createPublishedMovie(testApp, admin, { title: 'Inception Archived' })
    ).id;
    expectStatus(
      await adminWrite(testApp, admin, 'patch', `${API}/admin/movies/${movie.archived}`).send({
        status: 'archived',
      }),
      200,
    );
    await credit(movie.inception, [
      { personId: person.mona, role: 'director' },
      { personId: person.helmy, role: 'actor', characterName: 'Cobb' },
    ]);
    await credit(movie.kira, [{ personId: person.helmy, role: 'actor' }]);
    await credit(movie.draft, [
      { personId: person.hidden, role: 'actor' },
      { personId: person.helmy, role: 'writer' },
    ]);
    await credit(movie.archived, [{ personId: person.hidden, role: 'producer' }]);
    await uploadPoster(testApp, admin, movie.inception);

    theater.nile = await theaterWithStatus(testApp, admin, 'active', {
      name: 'Nile Cinema',
      district: 'Zamalek',
    });
    theater.galaxy = await theaterWithStatus(testApp, admin, 'active', {
      name: 'Galaxy Mall',
      district: 'Maadi',
    });
    theater.maadiStars = await theaterWithStatus(testApp, admin, 'active', {
      name: 'Maadi Stars',
      district: 'Heliopolis',
    });
    theater.draft = await theaterWithStatus(testApp, admin, 'draft', {
      name: 'Nile Draft Cinema',
      district: 'Zamalek',
    });
    theater.paused = await theaterWithStatus(testApp, admin, 'sales_paused', {
      name: 'Nile Paused Cinema',
      district: 'Zamalek',
    });
  });

  afterAll(async () => {
    await testApp.close();
    await removeMediaDirectory(directory);
  });

  describe('movies', () => {
    it('ranks the whole title first, then a title starting with the query, then one containing it, then a close one', async () => {
      const response = await ok('inception');
      // "Interception" does not contain "inception" but is close enough: typo-tolerant, so last.
      expect(groupIds(response, 'movies')).toEqual([
        movie.inception,
        movie.point,
        movie.files,
        movie.interception,
      ]);
      expect(response.body.movies.hasMore).toBe(false);
      expect(response.body.q).toBe('inception');
    });

    it('a typo still finds the intended movie, ranked first', async () => {
      const response = await ok('Incepton');
      // No title contains "Incepton": every hit is typo-tolerant, the closest first.
      expect(groupIds(response, 'movies')).toEqual([movie.inception, movie.point, movie.files]);
      expect(response.body.movies.items[0]).toMatchObject({
        id: movie.inception,
        title: 'Inception',
        matchedPerson: null,
      });
    });

    it('answers the card fields, the poster with its alt text, and null for what is missing', async () => {
      const response = await ok('inception');
      const [first, second] = response.body.movies.items;
      expect(first).toEqual({
        id: movie.inception,
        title: 'Inception',
        status: 'now_showing',
        releaseDate: '2026-10-01',
        runtimeMinutes: 120,
        ageRating: '12+',
        poster: {
          alt: 'Inception poster',
          variants: expect.arrayContaining([
            expect.objectContaining({ name: 'small', url: expect.any(String) }),
          ]),
        },
        matchedPerson: null,
      });
      expect(second).toMatchObject({ id: movie.point, status: 'coming_soon', poster: null });
    });

    it('finds movies by their cast and names the matched person; never a draft through its cast', async () => {
      const response = await ok('helmy');
      expect(groupIds(response, 'movies')).toEqual([movie.inception, movie.kira]);
      for (const item of response.body.movies.items) {
        expect(item.matchedPerson).toEqual({ id: person.helmy, fullName: 'Ahmed Helmy' });
      }
    });

    it('never shows a draft or an archived movie, by title or by cast', async () => {
      const titles = await ok('inception');
      expect(groupIds(titles, 'movies')).not.toContain(movie.draft);
      expect(groupIds(titles, 'movies')).not.toContain(movie.archived);
      expect(groupIds(await ok('draft'), 'movies')).toEqual([]);
      expect(groupIds(await ok('archived'), 'movies')).toEqual([]);
      expect(groupIds(await ok('ahmed hidden'), 'movies')).toEqual([]);
    });
  });

  describe('people', () => {
    it('finds people credited on a public movie, with their roles', async () => {
      const response = await ok('ahmed');
      // Ahmed Hidden is credited only on a draft and an archived movie; Ahmed Nobody on none.
      expect(response.body.people.items).toEqual([
        { id: person.helmy, fullName: 'Ahmed Helmy', photo: null, roles: ['actor'] },
      ]);
    });

    it('takes a typo in a name, and the roles come from the public credits only', async () => {
      const response = await ok('mona zaky');
      expect(response.body.people.items).toEqual([
        { id: person.mona, fullName: 'Mona Zaki', photo: null, roles: ['director'] },
      ]);
      expect(response.body.movies.items).toEqual([
        expect.objectContaining({
          id: movie.inception,
          matchedPerson: { id: person.mona, fullName: 'Mona Zaki' },
        }),
      ]);
      // Helmy's writer credit is on the draft, so it is not among his public roles.
      expect((await ok('ahmed helmy')).body.people.items[0].roles).toEqual(['actor']);
    });
  });

  describe('theaters', () => {
    it('finds active theaters by name, never a draft or a sales-paused one', async () => {
      const response = await ok('nile');
      expect(response.body.theaters.items).toEqual([
        {
          id: theater.nile,
          name: 'Nile Cinema',
          status: 'active',
          district: 'Zamalek',
          city: 'Cairo',
          cover: null,
        },
      ]);
    });

    it('finds theaters by area, a typo included', async () => {
      expect(groupIds(await ok('zamalek'), 'theaters')).toEqual([theater.nile]);
      expect(groupIds(await ok('Zamalik'), 'theaters')).toEqual([theater.nile]);
    });

    it('ranks by how well the value matched: a whole district before a name prefix', async () => {
      expect(groupIds(await ok('maadi'), 'theaters')).toEqual([theater.galaxy, theater.maadiStars]);
    });
  });

  it('answers empty groups when nothing matches, and treats % and _ as plain characters', async () => {
    for (const q of ['zzqx', '%_', '%%']) {
      const response = await ok(q);
      expect(response.body).toEqual({
        q,
        movies: { items: [], hasMore: false },
        people: { items: [], hasMore: false },
        theaters: { items: [], hasMore: false },
      });
    }
  });

  it('answers at most 5 per group and says when there are more', async () => {
    for (let index = 1; index <= 6; index += 1) {
      await createPublishedMovie(testApp, admin, { title: `Overflow Picture ${index}` });
    }
    const response = await ok('overflow picture');
    expect(response.body.movies.items).toHaveLength(5);
    expect(response.body.movies.hasMore).toBe(true);
  });

  it('costs the same number of queries whatever it finds (no N+1)', async () => {
    // One query per group, and one image lookup for a group with an image.
    const none = await countQueries(testApp, () => ok('zzqx'));
    const one = await countQueries(testApp, () => ok('kira'));
    const many = await countQueries(testApp, () => ok('in'));
    expect(none).toBe(3);
    expect(one).toBe(3);
    expect(many).toBe(4);
  });

  it('may be cached for a minute; an error never', async () => {
    const response = await ok('nile');
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    const refused = await searchPublic(testApp, 'x');
    expectError(refused, 400, 'VALIDATION_FAILED');
    expect(refused.headers['cache-control']).toBe('no-store');
  });

  it('ignores a token: anyone sees the same public results', async () => {
    const response = expectStatus(
      await searchPublic(testApp, 'inception', admin.authorization),
      200,
    );
    expect(groupIds(response, 'movies')).toEqual([
      movie.inception,
      movie.point,
      movie.files,
      movie.interception,
    ]);
  });

  it.each([
    ['missing', undefined],
    ['one character after trimming', '  a  '],
    ['longer than 100 characters', 'x'.repeat(101)],
    ['a NUL character', 'ab\u0000c'],
  ])('refuses q %s with VALIDATION_FAILED on q', async (_case, q) => {
    const request = testApp.http().get(`${API}/search`);
    const response = await (q === undefined ? request : request.query({ q }));
    expectError(response, 400, 'VALIDATION_FAILED');
    const fields = (response.body.error.details as { fields: { field: string }[] }).fields;
    expect(fields.map((field) => field.field)).toEqual(['q']);
  });
});
