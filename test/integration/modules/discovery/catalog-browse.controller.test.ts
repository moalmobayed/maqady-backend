import type { MovieDetailsResponse } from '../../../../src/modules/discovery/dto/movie-details.response';
import type { GenreWithCountPage } from '../../../../src/modules/discovery/dto/genre-with-count.response';
import type {
  MovieCardPageResponse,
  SimilarMoviesResponse,
} from '../../../../src/modules/discovery/dto/movie-lists.response';
import type { PublicPersonPageResponse } from '../../../../src/modules/discovery/dto/public-person.response';
import {
  adminWrite,
  createDraftMovie,
  createPerson,
  createPublishedMovie,
  expectStatus,
  genreId,
  idsOf,
} from '../../../support/catalog';
import { countQueries, uploadBackdrop, uploadPoster } from '../../../support/discovery';
import { mediaDirectory, removeMediaDirectory } from '../../../support/media';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { buildTestConfig } from '../../../support/test-config';
import type { StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(180_000);

const API = '/api/v1';

describe('The public catalog reads', () => {
  let directory: string;
  let testApp: TestApp;
  let admin: StaffSession;
  const movie = { a: 0, b: 0, c: 0, d: 0, e: 0, draft: 0, archived: 0 };
  const person = { karim: 0, hala: 0, draftOnly: 0, uncredited: 0 };

  const get = (path: string) => testApp.http().get(`${API}${path}`);
  const ok = async <T>(path: string): Promise<T> => expectStatus(await get(path), 200).body as T;

  beforeAll(async () => {
    directory = await mediaDirectory();
    testApp = await createTestApp({
      config: buildTestConfig({}, { LOCAL_STORAGE_DIR: directory }),
    });
    admin = await staffSession(testApp, 'admin');
    person.karim = (
      await createPerson(testApp, admin, { fullName: 'Karim Fahmy', roles: ['actor'] })
    ).id;
    person.hala = (await createPerson(testApp, admin, { fullName: 'Hala Ezzat' })).id;
    person.draftOnly = (await createPerson(testApp, admin, { fullName: 'Draft Only' })).id;
    person.uncredited = (await createPerson(testApp, admin, { fullName: 'Nobody Credited' })).id;

    movie.a = (
      await createPublishedMovie(testApp, admin, {
        title: 'The Last Lighthouse',
        releaseDate: '2026-10-01',
        genres: ['mystery', 'drama'],
      })
    ).id;
    movie.b = (
      await createPublishedMovie(testApp, admin, {
        title: 'Nile After Midnight',
        releaseDate: '2026-10-05',
        genres: ['drama'],
      })
    ).id;
    movie.c = (
      await createPublishedMovie(testApp, admin, {
        title: 'Echo Chamber',
        releaseDate: '2026-09-20',
        genres: ['drama', 'mystery'],
      })
    ).id;
    movie.d = (
      await createPublishedMovie(testApp, admin, {
        title: 'Sandstorm Protocol',
        releaseDate: '2026-09-10',
        genres: ['action'],
      })
    ).id;
    movie.e = (
      await createPublishedMovie(testApp, admin, {
        title: 'Desert Signal',
        status: 'coming_soon',
        releaseDate: '2026-11-10',
        genres: ['drama', 'mystery'],
      })
    ).id;
    movie.draft = (
      await createDraftMovie(testApp, admin, {
        title: 'Hidden draft lighthouse',
        genreIds: [await genreId(testApp, 'drama')],
      })
    ).id;
    movie.archived = (
      await createPublishedMovie(testApp, admin, {
        title: 'Hidden archived lighthouse',
        genres: ['drama', 'mystery'],
      })
    ).id;
    expectStatus(
      await adminWrite(testApp, admin, 'patch', `${API}/admin/movies/${movie.archived}`).send({
        status: 'archived',
      }),
      200,
    );

    // The Last Lighthouse: credits, two videos, a backdrop still, a behind-the-scenes photo, a poster.
    expectStatus(
      await adminWrite(testApp, admin, 'put', `${API}/admin/movies/${movie.a}/credits`).send({
        credits: [
          { personId: person.hala, role: 'director' },
          { personId: person.karim, role: 'actor', characterName: 'Youssef, the keeper' },
        ],
      }),
      200,
    );
    expectStatus(
      await adminWrite(testApp, admin, 'put', `${API}/admin/movies/${movie.draft}/credits`).send({
        credits: [{ personId: person.draftOnly, role: 'actor' }],
      }),
      200,
    );
    for (const [youtubeId, kind] of [
      ['aBcDeFgHiJk', 'trailer'],
      ['dQw4w9WgXcQ', 'teaser'],
    ] as const) {
      expectStatus(
        await adminWrite(testApp, admin, 'post', `${API}/admin/movies/${movie.a}/videos`).send({
          url: `https://youtu.be/${youtubeId}`,
          title: kind === 'trailer' ? 'Official trailer' : 'Teaser',
          kind,
        }),
        201,
      );
    }
    const detail = expectStatus(
      await testApp
        .http()
        .get(`${API}/admin/movies/${movie.a}`)
        .set('Authorization', admin.authorization),
      200,
    ).body as { videos: { id: number }[] };
    expectStatus(
      await adminWrite(testApp, admin, 'patch', `${API}/admin/movies/${movie.a}`).send({
        heroVideoId: detail.videos[0]!.id,
      }),
      200,
    );
    await uploadBackdrop(testApp, admin, movie.a);
    await uploadPoster(testApp, admin, movie.a);
  });

  afterAll(async () => {
    await testApp.close();
    await removeMediaDirectory(directory);
  });

  describe('GET /genres', () => {
    it('lists every genre alphabetically with public movies counted in both tabs', async () => {
      const response = expectStatus(await get('/genres'), 200);
      expect(response.headers['cache-control']).toBe('public, max-age=60');
      const { items, total, nextCursor } = response.body as GenreWithCountPage;
      expect(total).toBe(10);
      expect(nextCursor).toBeNull();
      const counts = Object.fromEntries(items.map((genre) => [genre.slug, genre.movieCount]));
      // Drama: A, B, C, E (the draft and the archived movie never count).
      expect(counts).toMatchObject({ drama: 4, mystery: 3, action: 1, comedy: 0 });
      expect(items[0]).toEqual({
        id: expect.any(Number),
        name: 'Action',
        slug: 'action',
        movieCount: 1,
      });
    });

    it('counts one tab with status', async () => {
      const { items } = await ok<GenreWithCountPage>('/genres?status=coming_soon');
      const drama = items.find((genre) => genre.slug === 'drama')!;
      expect(drama.movieCount).toBe(1);
    });

    it('pages with the cursor without repeating or skipping a genre', async () => {
      const slugs: string[] = [];
      let cursor: string | null = null;
      do {
        const query: string = cursor === null ? '' : `&cursor=${cursor}`;
        const page: { items: { slug: string }[]; nextCursor: string | null } =
          await ok<GenreWithCountPage>(`/genres?limit=3${query}`);
        expect(page.items.length).toBeLessThanOrEqual(3);
        slugs.push(...page.items.map((genre) => genre.slug));
        cursor = page.nextCursor;
      } while (cursor !== null);
      expect(slugs).toHaveLength(10);
      expect(new Set(slugs).size).toBe(10);
    });

    it('refuses a status that is not public, and a tampered cursor', async () => {
      for (const path of ['/genres?status=draft', '/genres?cursor=bm90LWEtY3Vyc29y']) {
        const response = await get(path);
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
    });
  });

  describe('GET /movies', () => {
    it('lists Now showing newest release first with both tab counts by default', async () => {
      const body = await ok<MovieCardPageResponse>('/movies');
      expect(idsOf(body.items)).toEqual([movie.b, movie.a, movie.c, movie.d]);
      expect(body.total).toBe(4);
      expect(body.nextCursor).toBeNull();
      expect(body.tabCounts).toEqual({ nowShowing: 4, comingSoon: 1 });
      expect(Object.keys(body.items[0]!).sort()).toEqual(
        [
          'ageRating',
          'genres',
          'id',
          'poster',
          'releaseDate',
          'runtimeMinutes',
          'status',
          'title',
        ].sort(),
      );
    });

    it('lists Coming soon soonest first', async () => {
      expect(idsOf((await ok<MovieCardPageResponse>('/movies?status=coming_soon')).items)).toEqual([
        movie.e,
      ]);
    });

    it('filters by genre slugs (any of them), and counts the tabs with the filter', async () => {
      const mystery = await ok<MovieCardPageResponse>('/movies?genres=mystery');
      expect(idsOf(mystery.items)).toEqual([movie.a, movie.c]);
      expect(mystery.tabCounts).toEqual({ nowShowing: 2, comingSoon: 1 });
      expect(
        idsOf((await ok<MovieCardPageResponse>('/movies?genres=action,mystery')).items),
      ).toEqual([movie.a, movie.c, movie.d]);
    });

    it('refuses an unknown genre slug', async () => {
      const response = await get('/movies?genres=drama,western');
      expect(response.status).toBe(400);
      expect(response.body.error).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { fields: [{ field: 'genres', messages: ['unknown genre: western'] }] },
      });
    });

    it('searches titles and credited names, and filters by person', async () => {
      expect(idsOf((await ok<MovieCardPageResponse>('/movies?q=lighthouse')).items)).toEqual([
        movie.a,
      ]);
      expect(idsOf((await ok<MovieCardPageResponse>('/movies?q=KARIM')).items)).toEqual([movie.a]);
      expect(
        idsOf(
          (await ok<MovieCardPageResponse>(`/movies?people=${person.karim},${person.draftOnly}`))
            .items,
        ),
      ).toEqual([movie.a]);
      expect((await ok<MovieCardPageResponse>('/movies?q=hidden')).items).toEqual([]);
      expect((await ok<MovieCardPageResponse>('/movies?q=hidden')).tabCounts).toEqual({
        nowShowing: 0,
        comingSoon: 0,
      });
    });

    it('pages with the cursor without repeats, at a fixed query cost', async () => {
      const first = await ok<MovieCardPageResponse>('/movies?limit=2');
      expect(idsOf(first.items)).toEqual([movie.b, movie.a]);
      const second = await ok<MovieCardPageResponse>(`/movies?limit=2&cursor=${first.nextCursor}`);
      expect(idsOf(second.items)).toEqual([movie.c, movie.d]);
      expect(second.nextCursor).toBeNull();
      const two = await countQueries(testApp, () => get('/movies?limit=2'));
      const four = await countQueries(testApp, () => get('/movies?limit=4'));
      expect(four).toBe(two);
    });

    it('refuses bad filters', async () => {
      for (const path of [
        '/movies?status=archived',
        '/movies?q=a',
        '/movies?people=x',
        '/movies?limit=101',
      ]) {
        const response = await get(path);
        expect({ path, status: response.status }).toEqual({ path, status: 400 });
      }
    });
  });

  describe('GET /movies/{id}', () => {
    it("returns a public movie's page with its media and credits in order", async () => {
      const response = expectStatus(await get(`/movies/${movie.a}`), 200);
      expect(response.headers['cache-control']).toBe('public, max-age=60');
      const body = response.body as MovieDetailsResponse;
      expect(body).toMatchObject({
        id: movie.a,
        title: 'The Last Lighthouse',
        status: 'now_showing',
        releaseDate: '2026-10-01',
        genres: [{ slug: 'mystery' }, { slug: 'drama' }],
        heroVideo: { youtubeId: 'aBcDeFgHiJk', kind: 'trailer' },
      });
      expect(body.videos.map((video) => video.youtubeId)).toEqual(['aBcDeFgHiJk', 'dQw4w9WgXcQ']);
      expect(body.photos).toEqual([expect.objectContaining({ kind: 'still', caption: 'A still' })]);
      expect(body.photos[0]!.image.alt).toBe('A still');
      expect(body.backdrop!.alt).toBe('The Last Lighthouse');
      expect(body.poster!.alt).toBe('The Last Lighthouse poster');
      expect(
        body.credits.map((credit) => [credit.role, credit.characterName, credit.person.id]),
      ).toEqual([
        ['director', null, person.hala],
        ['actor', 'Youssef, the keeper', person.karim],
      ]);
    });

    it('is NOT_FOUND for a draft, an archived or an unknown movie', async () => {
      for (const id of [movie.draft, movie.archived, 999999]) {
        const response = await get(`/movies/${id}`);
        expect({ id, status: response.status, code: response.body.error.code }).toEqual({
          id,
          status: 404,
          code: 'NOT_FOUND',
        });
      }
      expect((await get('/movies/abc')).status).toBe(400);
    });

    it('never lets a shared cache keep an error: no public Cache-Control on a 404 or a 400', async () => {
      for (const path of [
        `/movies/${movie.draft}`,
        `/movies/${movie.archived}/similar`,
        '/movies/abc',
        '/movies?status=archived',
        '/genres?status=draft',
        '/people?roleGroup=extras',
      ]) {
        const response = await get(path);
        expect({
          path,
          status: response.status >= 400,
          cacheControl: response.headers['cache-control'],
        }).toEqual({
          path,
          status: true,
          cacheControl: 'no-store',
        });
      }
    });
  });

  describe('GET /movies/{id}/similar', () => {
    it('ranks Now showing movies by shared genres, never the movie itself', async () => {
      const body = await ok<SimilarMoviesResponse>(`/movies/${movie.a}/similar`);
      // C shares mystery and drama, B drama only; D shares none, E and the archived one aren't Now showing.
      expect(idsOf(body.items)).toEqual([movie.c, movie.b]);
    });

    it('is NOT_FOUND for a movie that is not public', async () => {
      expect((await get(`/movies/${movie.draft}/similar`)).status).toBe(404);
      expect((await get(`/movies/${movie.archived}/similar`)).status).toBe(404);
    });
  });

  describe('GET /people', () => {
    it('lists only people credited on a public movie, by name', async () => {
      const body = await ok<PublicPersonPageResponse>('/people');
      expect(idsOf(body.items)).toEqual([person.hala, person.karim]);
      expect(body.total).toBe(2);
      expect(body.items[1]).toMatchObject({
        fullName: 'Karim Fahmy',
        roles: ['actor'],
        photo: null,
      });
    });

    it('filters by name and by role group', async () => {
      expect(idsOf((await ok<PublicPersonPageResponse>('/people?q=fahm')).items)).toEqual([
        person.karim,
      ]);
      expect(
        idsOf((await ok<PublicPersonPageResponse>('/people?roleGroup=directors')).items),
      ).toEqual([person.hala]);
      expect((await get('/people?roleGroup=extras')).status).toBe(400);
    });
  });
});
