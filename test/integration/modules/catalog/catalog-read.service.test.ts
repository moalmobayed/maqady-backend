import { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { CatalogReadService } from '../../../../src/modules/catalog/catalog-read.service';
import {
  adminWrite,
  createDraftMovie,
  createPerson,
  createPublishedMovie,
  expectStatus,
  genreId,
} from '../../../support/catalog';
import { waitForLockWaiters } from '../../../support/database';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { CatalogBody, StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(60_000);

const MOVIES = '/api/v1/admin/movies';
const FIRST_PAGE = { after: null, limit: 20 } as const;

describe('CatalogReadService, the reads U7 and U8 build on (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let reads: CatalogReadService;
  let nowA: CatalogBody;
  let nowB: CatalogBody;
  let nowC: CatalogBody;
  let soonA: CatalogBody;
  let soonB: CatalogBody;
  let draft: CatalogBody;
  let archived: CatalogBody;
  let actorId: number;
  let draftOnlyId: number;

  beforeAll(async () => {
    testApp = await createTestApp();
    admin = await staffSession(testApp, 'admin');
    reads = testApp.app.get(CatalogReadService);

    nowA = await createPublishedMovie(testApp, admin, {
      title: 'The Last Lighthouse',
      releaseDate: '2026-10-01',
      genres: ['mystery', 'drama'],
      featuredPosition: 2,
    });
    nowB = await createPublishedMovie(testApp, admin, {
      title: 'Harbour Lights',
      releaseDate: '2026-09-01',
      genres: ['drama', 'mystery', 'romance'],
      heroYoutubeId: 'BBBBBBBBBBB',
      featuredPosition: 1,
    });
    nowC = await createPublishedMovie(testApp, admin, {
      title: 'Speed Run',
      releaseDate: '2026-10-10',
      genres: ['action'],
    });
    soonA = await createPublishedMovie(testApp, admin, {
      title: 'Desert Signal',
      status: 'coming_soon',
      releaseDate: '2026-11-20',
      genres: ['sci-fi'],
    });
    soonB = await createPublishedMovie(testApp, admin, {
      title: 'Nile Morning',
      status: 'coming_soon',
      releaseDate: '2026-10-28',
      genres: ['drama'],
    });
    draft = await createDraftMovie(testApp, admin, {
      title: 'Hidden Draft',
      genreIds: [await genreId(testApp, 'drama')],
    });
    archived = await createPublishedMovie(testApp, admin, {
      title: 'Old Lights',
      genres: ['drama'],
    });
    expectStatus(
      await adminWrite(testApp, admin, 'patch', `${MOVIES}/${archived.id}`).send({
        status: 'archived',
      }),
      200,
    );

    const actor = await createPerson(testApp, admin, {
      fullName: 'Karim Fahmy',
      roles: ['writer'],
    });
    actorId = actor.id;
    const draftOnly = await createPerson(testApp, admin, { fullName: 'Dina Draft' });
    draftOnlyId = draftOnly.id;
    expectStatus(
      await adminWrite(testApp, admin, 'put', `${MOVIES}/${nowB.id}/credits`).send({
        credits: [{ personId: actor.id, role: 'actor', characterName: 'Sailor' }],
      }),
      200,
    );
    expectStatus(
      await adminWrite(testApp, admin, 'put', `${MOVIES}/${draft.id}/credits`).send({
        credits: [{ personId: draftOnly.id, role: 'director' }],
      }),
      200,
    );
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('lists the genres alphabetically with their slugs', async () => {
    const genres = await reads.listGenres();
    expect(genres.map((genre) => genre.name)).toEqual([
      'Action',
      'Adventure',
      'Animation',
      'Comedy',
      'Drama',
      'Family',
      'Mystery',
      'Romance',
      'Sci-fi',
      'Thriller',
    ]);
    expect(genres.find((genre) => genre.name === 'Sci-fi')?.slug).toBe('sci-fi');
  });

  it('lists each public tab in its order, never drafts or archived movies', async () => {
    const now = await reads.listPublicMovies({ status: 'now_showing' }, FIRST_PAGE);
    expect(now.items.map((movie) => movie.id)).toEqual([nowC.id, nowA.id, nowB.id]);
    expect(now.total).toBe(3);
    expect(now.items[1]).toEqual(
      expect.objectContaining({
        title: 'The Last Lighthouse',
        status: 'now_showing',
        synopsis: 'A test synopsis.',
        runtimeMinutes: 120,
        releaseDate: '2026-10-01',
        ageRating: '12+',
        poster: null,
      }),
    );
    expect(now.items[1]!.genres.map((genre) => genre.slug)).toEqual(['mystery', 'drama']);

    const soon = await reads.listPublicMovies({ status: 'coming_soon' }, FIRST_PAGE);
    expect(soon.items.map((movie) => movie.id)).toEqual([soonB.id, soonA.id]);

    const paged = await reads.listPublicMovies(
      { status: 'now_showing' },
      { after: null, limit: 2 },
    );
    expect(paged.nextCursor).not.toBeNull();
    const [, last] = paged.items;
    const rest = await reads.listPublicMovies(
      { status: 'now_showing' },
      { after: { sortKey: last!.releaseDate, id: last!.id }, limit: 2 },
    );
    expect(rest.items.map((movie) => movie.id)).toEqual([nowB.id]);
  });

  it('filters by genres, people, search and a set of movies', async () => {
    const drama = await genreId(testApp, 'drama');
    const action = await genreId(testApp, 'action');
    const ids = async (filter: Parameters<CatalogReadService['listPublicMovies']>[0]) =>
      (await reads.listPublicMovies(filter, FIRST_PAGE)).items.map((movie) => movie.id);

    expect(await ids({ status: 'now_showing', genreIds: [drama, action] })).toEqual([
      nowC.id,
      nowA.id,
      nowB.id,
    ]);
    expect(await ids({ status: 'now_showing', genreIds: [action] })).toEqual([nowC.id]);
    expect(await ids({ status: 'now_showing', personIds: [actorId] })).toEqual([nowB.id]);
    expect(await ids({ status: 'now_showing', q: 'lights' })).toEqual([nowB.id]);
    expect(await ids({ status: 'now_showing', q: 'fahmy' })).toEqual([nowB.id]);
    expect(await ids({ status: 'now_showing', movieIds: [nowA.id, draft.id] })).toEqual([nowA.id]);
    expect(await ids({ status: 'now_showing', movieIds: [] })).toEqual([]);
  });

  it('counts the tabs and the genres with the same filters', async () => {
    expect(await reads.countPublicMovies()).toEqual({ coming_soon: 2, now_showing: 3 });
    expect(await reads.countPublicMovies({ q: 'light' })).toEqual({
      coming_soon: 0,
      now_showing: 2,
    });

    const drama = await genreId(testApp, 'drama');
    const mystery = await genreId(testApp, 'mystery');
    const byGenre = await reads.countPublicMoviesByGenre();
    expect(byGenre.get(drama)).toBe(3);
    expect(byGenre.get(mystery)).toBe(2);
    expect(byGenre.has(await genreId(testApp, 'comedy'))).toBe(false);
    expect((await reads.countPublicMoviesByGenre({ status: 'coming_soon' })).get(drama)).toBe(1);
  });

  it("returns a public movie's page with its genres, credits and videos, and null for a draft", async () => {
    const details = await reads.findPublicMovie(nowB.id);
    expect(details).toEqual(
      expect.objectContaining({
        id: nowB.id,
        title: 'Harbour Lights',
        language: null,
        backdrop: null,
        photos: [],
      }),
    );
    expect(details!.genres.map((genre) => genre.slug)).toEqual(['drama', 'mystery', 'romance']);
    expect(details!.credits).toEqual([
      {
        id: expect.any(Number),
        role: 'actor',
        characterName: 'Sailor',
        position: 0,
        person: { id: actorId, fullName: 'Karim Fahmy', photo: null },
      },
    ]);
    expect(details!.heroVideo).toEqual(
      expect.objectContaining({ youtubeId: 'BBBBBBBBBBB', kind: 'trailer', durationSeconds: 134 }),
    );
    expect(details!.videos).toHaveLength(1);
    expect(await reads.findPublicMovie(draft.id)).toBeNull();
    expect(await reads.findPublicMovie(archived.id)).toBeNull();
    expect(await reads.findPublicMovie(987654)).toBeNull();

    const byIds = await reads.findPublicMoviesByIds([nowA.id, draft.id, soonA.id]);
    expect([...byIds.keys()].sort((a, b) => a - b)).toEqual(
      [nowA.id, soonA.id].sort((a, b) => a - b),
    );
  });

  it('lists the carousel by position with each hero video', async () => {
    const featured = await reads.listFeatured();
    expect(
      featured.map((slide) => [slide.position, slide.movie.id, slide.heroVideo.youtubeId]),
    ).toEqual([
      [1, nowB.id, 'BBBBBBBBBBB'],
      [2, nowA.id, 'aBcDeFgHiJk'],
    ]);
    expect(featured[0]!.backdrop).toBeNull();
  });

  it('ranks similar Now showing movies by shared genres, never the movie itself', async () => {
    const similar = await reads.listSimilar(nowA.id);
    expect(similar.map((movie) => movie.id)).toEqual([nowB.id]);
    expect((await reads.listSimilar(soonB.id)).map((movie) => movie.id)).toEqual([
      nowA.id,
      nowB.id,
    ]);
    expect(await reads.listSimilar(nowC.id)).toEqual([]);
  });

  it('lists only people credited on a public movie, with the union of their roles', async () => {
    const people = await reads.listPublicPeople({}, FIRST_PAGE);
    expect(people.items).toEqual([
      { id: actorId, fullName: 'Karim Fahmy', photo: null, roles: ['actor', 'writer'] },
    ]);
    expect(people.items.map((person) => person.id)).not.toContain(draftOnlyId);
    expect((await reads.listPublicPeople({ roleGroup: 'directors' }, FIRST_PAGE)).items).toEqual(
      [],
    );
    expect((await reads.listPublicPeople({ q: 'karim' }, FIRST_PAGE)).total).toBe(1);
  });

  it('finds movies of any status for U7, with their runtime and status', async () => {
    const refs = await reads.findMoviesByIds([draft.id, archived.id, 987654]);
    expect(refs.get(draft.id)).toEqual(
      expect.objectContaining({ title: 'Hidden Draft', status: 'draft', runtimeMinutes: null }),
    );
    expect(refs.get(archived.id)?.status).toBe('archived');
    expect(refs.has(987654)).toBe(false);
  });

  it('holds a status change until the scheduling transaction that locked the movie ends', async () => {
    const transactions = testApp.app.get(TransactionRepository);
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const scheduling = transactions.run(async () => {
      const info = await reads.lockMovieForShare(nowC.id);
      expect(info).toEqual({
        id: nowC.id,
        title: 'Speed Run',
        status: 'now_showing',
        runtimeMinutes: 120,
      });
      locked();
      await released;
    });
    await lockTaken;

    let archivedAt: number | undefined;
    const archive = adminWrite(testApp, admin, 'patch', `${MOVIES}/${nowC.id}`)
      .send({ status: 'archived' })
      .then((response) => {
        archivedAt = Date.now();
        return response;
      });
    await waitForLockWaiters(testApp.knex, 1);
    expect(archivedAt).toBeUndefined();
    const releasedAt = Date.now();
    release();
    await scheduling;
    const response = await archive;
    expect(response.status).toBe(200);
    expect(archivedAt).toBeGreaterThanOrEqual(releasedAt);
    expect(await reads.lockMovieForShare(987654)).toBeNull();
  });

  it('costs the same number of queries for one movie and for many', async () => {
    const countQueries = async (run: () => Promise<unknown>): Promise<number> => {
      let count = 0;
      const listener = (): void => {
        count += 1;
      };
      testApp.knex.on('query', listener);
      try {
        await run();
      } finally {
        testApp.knex.removeListener('query', listener);
      }
      return count;
    };
    const one = await countQueries(() =>
      reads.listPublicMovies({ status: 'coming_soon' }, { after: null, limit: 1 }),
    );
    const many = await countQueries(() =>
      reads.listPublicMovies({ status: 'coming_soon' }, { after: null, limit: 20 }),
    );
    expect(many).toBe(one);
  });
});
