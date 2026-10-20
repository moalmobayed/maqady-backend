import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { TestClock } from '../../../support/clock';
import {
  adminWrite,
  createDraftMovie,
  createPerson,
  createPublishedMovie,
  expectStatus,
  genreId,
  idsOf,
} from '../../../support/catalog';
import { CatalogProbeModule, TestBookingsBlocker } from '../../../support/catalog-probe.module';
import { listHttpRoutes, samplePath } from '../../../support/routes';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(60_000);

const MOVIES = '/api/v1/admin/movies';

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

function fieldsOf(response: Response): string[] {
  return (response.body.error.details.fields as { field: string }[]).map((entry) => entry.field);
}

interface AuditRow {
  action: string;
  entity_type: string;
  entity_id: number | null;
  actor_staff_user_id: number | null;
  changed_fields: string[];
  metadata: Record<string, unknown>;
}

describe('Admin movie routes (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  const clock = new TestClock(new Date('2026-10-16T12:00:00Z'));

  beforeAll(async () => {
    testApp = await createTestApp({ clock, imports: [CatalogProbeModule] });
    admin = await staffSession(testApp, 'admin', { fullName: 'Mona Adel' });
  });

  afterAll(async () => {
    await testApp.close();
  });

  const get = (path: string, session: StaffSession = admin) =>
    testApp.http().get(path).set('Authorization', session.authorization);
  const patch = (id: number, body: object, session: StaffSession = admin) =>
    adminWrite(testApp, session, 'patch', `${MOVIES}/${id}`).send(body);
  const addVideo = (id: number, youtubeId: string) =>
    adminWrite(testApp, admin, 'post', `${MOVIES}/${id}/videos`).send({
      url: `https://www.youtube.com/watch?v=${youtubeId}`,
      title: 'Trailer',
      kind: 'trailer',
    });
  const auditOf = (entityId: number, entityType = 'movie') =>
    testApp
      .knex('audit_events')
      .select<AuditRow[]>(
        'action',
        'entity_type',
        'entity_id',
        'actor_staff_user_id',
        'changed_fields',
        'metadata',
      )
      .where({ entity_type: entityType, entity_id: entityId })
      .orderBy('id');

  describe('create, edit, publish and archive', () => {
    it('creates a draft with only a title, 12+ by default, by the admin, audited', async () => {
      const response = await adminWrite(testApp, admin, 'post', MOVIES).send({
        title: '  The Last Lighthouse  ',
      });

      expect(response.status).toBe(201);
      expect(response.body).toEqual(
        expect.objectContaining({
          title: 'The Last Lighthouse',
          status: 'draft',
          ageRating: '12+',
          synopsis: null,
          genres: [],
          poster: null,
          photos: [],
          videos: [],
          credits: [],
          featuredPosition: null,
          publishBlockers: ['synopsis', 'runtimeMinutes', 'releaseDate', 'genres'],
          updatedBy: { id: admin.staffUserId, fullName: 'Mona Adel' },
          createdAt: '2026-10-16T15:00:00+03:00',
        }),
      );
      expect(await auditOf(response.body.id)).toEqual([
        expect.objectContaining({
          action: 'movie.created',
          actor_staff_user_id: admin.staffUserId,
          changed_fields: [],
          metadata: {},
        }),
      ]);
    });

    it('requires an Idempotency-Key on create and replays a retry', async () => {
      const missing = await testApp
        .http()
        .post(MOVIES)
        .set('Authorization', admin.authorization)
        .send({ title: 'No key' });
      expectError(missing, 400, 'IDEMPOTENCY_KEY_REQUIRED');

      const key = randomUUID();
      const send = () =>
        testApp
          .http()
          .post(MOVIES)
          .set('Authorization', admin.authorization)
          .set('Idempotency-Key', key)
          .send({ title: 'Once only' });
      const first = await send();
      const second = await send();
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.body.id).toBe(first.body.id);
      const rows = await testApp.knex('movies').select('id').where({ title: 'Once only' });
      expect(rows).toHaveLength(1);
    });

    it('walks a movie through publishing, editing, the status rules and archiving', async () => {
      const movie = await createDraftMovie(testApp, admin, { title: 'Desert Signal' });
      const mystery = await genreId(testApp, 'mystery');
      const drama = await genreId(testApp, 'drama');

      const refused = await patch(movie.id, { status: 'now_showing' });
      expectError(refused, 409, 'MOVIE_NOT_PUBLISHABLE');
      expect(refused.body.error.details).toEqual({
        missing: ['synopsis', 'runtimeMinutes', 'releaseDate', 'genres'],
      });

      const filled = await patch(movie.id, {
        synopsis: 'A signal from the desert.',
        runtimeMinutes: 112,
        releaseDate: '2026-10-28',
        genreIds: [mystery, drama],
        budgetLabel: 'EGP 48M',
      });
      expect(filled.status).toBe(200);
      expect((filled.body.genres as { slug: string }[]).map((genre) => genre.slug)).toEqual([
        'mystery',
        'drama',
      ]);
      expect(filled.body.publishBlockers).toEqual([]);
      expect(filled.body.status).toBe('draft');

      const published = await patch(movie.id, { status: 'now_showing' });
      expect(published.status).toBe(200);
      expect(published.body.status).toBe('now_showing');

      clock.advance({ minutes: 5 });
      const other = await staffSession(testApp, 'admin', { fullName: 'Omar Said' });
      const renamed = await patch(movie.id, { title: 'Desert Signal (2026)' }, other);
      expect(renamed.body.updatedBy).toEqual({ id: other.staffUserId, fullName: 'Omar Said' });
      expect(renamed.body.updatedAt).toBe('2026-10-16T15:05:00+03:00');

      const cleared = await patch(movie.id, { synopsis: null });
      expectError(cleared, 409, 'MOVIE_NOT_PUBLISHABLE');
      expect(cleared.body.error.details).toEqual({ missing: ['synopsis'] });
      const noGenres = await patch(movie.id, { genreIds: [] });
      expect(noGenres.body.error.details).toEqual({ missing: ['genres'] });

      for (const to of ['coming_soon', 'draft']) {
        const back = await patch(movie.id, { status: to });
        expectError(back, 409, 'CONFLICT');
        expect(back.body.error.details).toEqual({ from: 'now_showing', to });
      }

      expect((await patch(movie.id, { status: 'archived' })).body.status).toBe('archived');
      expect((await patch(movie.id, { status: 'coming_soon' })).body.status).toBe('coming_soon');
      expect((await patch(movie.id, { status: 'draft' })).body.status).toBe('draft');

      const actions = (await auditOf(movie.id)).map((row) => [
        row.action,
        row.changed_fields,
        row.metadata,
      ]);
      expect(actions).toEqual([
        ['movie.created', [], {}],
        [
          'movie.updated',
          ['budgetLabel', 'genreIds', 'releaseDate', 'runtimeMinutes', 'synopsis'],
          {},
        ],
        ['movie.status_changed', [], { from: 'draft', to: 'now_showing' }],
        ['movie.updated', ['title'], {}],
        ['movie.status_changed', [], { from: 'now_showing', to: 'archived' }],
        ['movie.status_changed', [], { from: 'archived', to: 'coming_soon' }],
        ['movie.status_changed', [], { from: 'coming_soon', to: 'draft' }],
      ]);
    });

    it('answers 200 and writes nothing for a change to nothing', async () => {
      const movie = await createDraftMovie(testApp, admin, { title: 'Same', runtimeMinutes: 90 });
      const before = await auditOf(movie.id);
      const response = await patch(movie.id, { title: 'Same', runtimeMinutes: 90 });
      expect(response.status).toBe(200);
      expect(await auditOf(movie.id)).toEqual(before);
    });

    it('refuses an unknown genre, an empty PATCH and an unknown movie', async () => {
      const movie = await createDraftMovie(testApp, admin);
      const unknown = await patch(movie.id, { genreIds: [999999] });
      expectError(unknown, 400, 'VALIDATION_FAILED');
      expect(unknown.body.error.details.fields).toEqual([
        { field: 'genreIds', messages: ['genreIds must name existing genres'] },
      ]);

      expectError(await patch(movie.id, {}), 400, 'VALIDATION_FAILED');
      expectError(await patch(987654, { title: 'x' }), 404, 'NOT_FOUND');
      expectError(await get(`${MOVIES}/987654`), 404, 'NOT_FOUND');
      expectError(await get(`${MOVIES}/abc`), 400, 'VALIDATION_FAILED');
    });

    it.each([
      ['ageRating', { ageRating: null }],
      ['status', { status: null }],
      ['genreIds', { genreIds: null }],
    ])('refuses null on %s, which cannot be cleared, and changes nothing', async (field, body) => {
      const movie = await createDraftMovie(testApp, admin, { ageRating: '16+' });
      const before = await auditOf(movie.id);

      const response = await patch(movie.id, body);

      expectError(response, 400, 'VALIDATION_FAILED');
      expect(fieldsOf(response)).toEqual([field]);
      const rows = await testApp
        .knex('movies')
        .select('age_rating', 'status')
        .where({ id: movie.id });
      expect(rows).toEqual([{ age_rating: '16+', status: 'draft' }]);
      expect(await auditOf(movie.id)).toEqual(before);
    });

    it.each([
      ['ageRating', { ageRating: null }],
      ['genreIds', { genreIds: null }],
    ])('refuses null on %s when creating', async (field, body) => {
      const response = await adminWrite(testApp, admin, 'post', MOVIES).send({
        title: 'Null field',
        ...body,
      });
      expectError(response, 400, 'VALIDATION_FAILED');
      expect(fieldsOf(response)).toEqual([field]);
    });
  });

  describe('the home carousel and the hero video', () => {
    beforeEach(async () => {
      await testApp.knex('movies').update({ featured_position: null });
    });

    it('features a public movie with a hero video, one movie per position', async () => {
      const draft = await createDraftMovie(testApp, admin);
      const notFeaturable = await patch(draft.id, { featuredPosition: 1 });
      expectError(notFeaturable, 409, 'MOVIE_NOT_FEATURABLE');
      expect(notFeaturable.body.error.details).toEqual({
        reasons: ['not_public', 'no_hero_video'],
      });

      const first = await createPublishedMovie(testApp, admin);
      const noHero = await patch(first.id, { featuredPosition: 1 });
      expect(noHero.body.error.details).toEqual({ reasons: ['no_hero_video'] });

      const withVideo = expectStatus(await addVideo(first.id, 'aBcDeFgHiJk'), 201);
      const heroId = withVideo.body.videos[0].id as number;
      const featured = await patch(first.id, { heroVideoId: heroId, featuredPosition: 1 });
      expect(featured.status).toBe(200);
      expect(featured.body).toEqual(
        expect.objectContaining({ featuredPosition: 1, heroVideoId: heroId }),
      );
      expect(featured.body.videos[0].isHero).toBe(true);

      const second = await createPublishedMovie(testApp, admin, { featuredPosition: 2 });
      const taken = await patch(second.id, { featuredPosition: 1 });
      expectError(taken, 409, 'FEATURED_POSITION_TAKEN');
      expect(taken.body.error.details).toEqual({ position: 1, movieId: first.id });
      expect((await patch(second.id, { featuredPosition: 3 })).body.featuredPosition).toBe(3);

      const foreignHero = await patch(second.id, { heroVideoId: heroId });
      expectError(foreignHero, 400, 'VALIDATION_FAILED');
      expect(foreignHero.body.error.details.fields[0].field).toBe('heroVideoId');

      const clearHero = await patch(first.id, { heroVideoId: null });
      expectError(clearHero, 409, 'MOVIE_NOT_FEATURABLE');
      expect(clearHero.body.error.details).toEqual({ reasons: ['no_hero_video'] });
      const deleteHero = await adminWrite(
        testApp,
        admin,
        'delete',
        `${MOVIES}/${first.id}/videos/${heroId}`,
      );
      expectError(deleteHero, 409, 'MOVIE_NOT_FEATURABLE');

      const unfeatured = await patch(first.id, { featuredPosition: null });
      expect(unfeatured.body.featuredPosition).toBeNull();
      expectStatus(
        await adminWrite(testApp, admin, 'delete', `${MOVIES}/${first.id}/videos/${heroId}`),
        204,
      );
      const after = await get(`${MOVIES}/${first.id}`);
      expect(after.body).toEqual(expect.objectContaining({ heroVideoId: null, videos: [] }));

      const featuredActions = (await auditOf(first.id))
        .filter((row) => row.action.includes('featured'))
        .map((row) => [row.action, row.metadata]);
      expect(featuredActions).toEqual([
        ['movie.featured', { position: 1, previousPosition: null }],
        ['movie.unfeatured', { previousPosition: 1 }],
      ]);
    });

    it('frees the position when a featured movie is archived', async () => {
      const movie = await createPublishedMovie(testApp, admin, { featuredPosition: 4 });
      const archived = await patch(movie.id, { status: 'archived' });
      expect(archived.body).toEqual(
        expect.objectContaining({ status: 'archived', featuredPosition: null }),
      );
      const actions = (await auditOf(movie.id)).slice(-2).map((row) => row.action);
      expect(actions).toEqual(['movie.status_changed', 'movie.unfeatured']);

      const next = await createPublishedMovie(testApp, admin, { featuredPosition: 4 });
      expect(next.featuredPosition).toBe(4);
    });

    it('backs the rules with the database: one movie per position, a hero on every featured movie', async () => {
      const one = await createPublishedMovie(testApp, admin, { featuredPosition: 5 });
      const two = await createPublishedMovie(testApp, admin, { featuredPosition: 2 });
      await expect(
        testApp.knex('movies').update({ featured_position: 5 }).where({ id: two.id }),
      ).rejects.toMatchObject({ code: '23505', constraint: 'uq_movies_featured_position' });
      await expect(
        testApp.knex('movies').update({ hero_video_id: null }).where({ id: one.id }),
      ).rejects.toMatchObject({ code: '23514', constraint: 'chk_movies_featured' });
    });

    it('lets one of two concurrent requests take a position, never both', async () => {
      const [first, second] = await Promise.all([
        createPublishedMovie(testApp, admin, { heroYoutubeId: 'AAAAAAAAAAA', featuredPosition: 1 }),
        createPublishedMovie(testApp, admin, { heroYoutubeId: 'BBBBBBBBBBB', featuredPosition: 2 }),
      ]);
      const responses = await Promise.all([
        patch(first.id, { featuredPosition: 3 }),
        patch(second.id, { featuredPosition: 3 }),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      const refused = responses.find((response) => response.status === 409)!;
      expect(['FEATURED_POSITION_TAKEN', 'CONFLICT']).toContain(refused.body.error.code);
      const holders = await testApp.knex('movies').where({ featured_position: 3 }).select('id');
      expect(holders).toHaveLength(1);
    });
  });

  describe('PATCH /admin/movies (bulk archive)', () => {
    it('archives every listed movie, reports the archived ones and frees positions', async () => {
      await testApp.knex('movies').update({ featured_position: null });
      const draft = await createDraftMovie(testApp, admin);
      const soon = await createPublishedMovie(testApp, admin, { status: 'coming_soon' });
      const featured = await createPublishedMovie(testApp, admin, { featuredPosition: 1 });
      const archived = await createDraftMovie(testApp, admin);
      expectStatus(await patch(archived.id, { status: 'archived' }), 200);

      const response = await adminWrite(testApp, admin, 'patch', MOVIES).send({
        movieIds: [featured.id, archived.id, draft.id, soon.id],
        status: 'archived',
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        archivedIds: [draft.id, soon.id, featured.id].sort((a, b) => a - b),
        alreadyArchivedIds: [archived.id],
      });
      const rows = await testApp
        .knex('movies')
        .select('id', 'status', 'featured_position')
        .whereIn('id', [draft.id, soon.id, featured.id]);
      expect(rows.every((row) => row.status === 'archived' && row.featured_position === null)).toBe(
        true,
      );
      const bulk = await testApp
        .knex('audit_events')
        .select('entity_id', 'metadata')
        .where({ action: 'movie.archived' })
        .orderBy('entity_id');
      expect(bulk).toEqual([
        {
          entity_id: Math.min(draft.id, soon.id),
          metadata: expect.objectContaining({ bulk: true }),
        },
        {
          entity_id: Math.max(draft.id, soon.id),
          metadata: expect.objectContaining({ bulk: true }),
        },
        { entity_id: featured.id, metadata: { from: 'now_showing', bulk: true } },
      ]);
    });

    it('changes nothing when an id is unknown', async () => {
      const draft = await createDraftMovie(testApp, admin);
      const response = await adminWrite(testApp, admin, 'patch', MOVIES).send({
        movieIds: [draft.id, 999999],
        status: 'archived',
      });
      expectError(response, 404, 'NOT_FOUND');
      expect(response.body.error.details).toEqual({ missingIds: [999999] });
      expect((await get(`${MOVIES}/${draft.id}`)).body.status).toBe('draft');
    });
  });

  describe('PUT /admin/movies/{id}/credits', () => {
    it('replaces the whole cast and crew in request order', async () => {
      const movie = await createDraftMovie(testApp, admin);
      const [actor, director, voice, writer] = await Promise.all([
        createPerson(testApp, admin, { fullName: 'Karim Fahmy' }),
        createPerson(testApp, admin, { fullName: 'Hala Nour' }),
        createPerson(testApp, admin, { fullName: 'Sami Adel' }),
        createPerson(testApp, admin, { fullName: 'Rana Lotfy' }),
      ]);
      const put = (credits: object[]) =>
        adminWrite(testApp, admin, 'put', `${MOVIES}/${movie.id}/credits`).send({ credits });

      const first = await put([
        { personId: actor.id, role: 'actor', characterName: ' Youssef ' },
        { personId: director.id, role: 'director' },
        { personId: voice.id, role: 'voice', characterName: 'The lamp' },
      ]);
      expect(first.status).toBe(200);
      expect(
        (first.body.credits as Record<string, unknown>[]).map((credit) => [
          (credit.person as { fullName: string }).fullName,
          credit.role,
          credit.characterName,
          credit.position,
        ]),
      ).toEqual([
        ['Karim Fahmy', 'actor', 'Youssef', 0],
        ['Hala Nour', 'director', null, 1],
        ['Sami Adel', 'voice', 'The lamp', 2],
      ]);

      const second = await put([
        { personId: writer.id, role: 'writer' },
        { personId: actor.id, role: 'director' },
      ]);
      expect(
        (second.body.credits as { role: string; position: number }[]).map((credit) => [
          credit.role,
          credit.position,
        ]),
      ).toEqual([
        ['writer', 0],
        ['director', 1],
      ]);
      expect((await put([])).body.credits).toEqual([]);

      const unknown = await put([
        { personId: writer.id, role: 'writer' },
        { personId: 999999, role: 'actor' },
      ]);
      expectError(unknown, 400, 'VALIDATION_FAILED');
      expect(unknown.body.error.details.fields).toEqual([
        { field: 'credits.1.personId', messages: ['personId must name an existing person'] },
      ]);
      const character = await put([{ personId: writer.id, role: 'writer', characterName: 'X' }]);
      expectError(character, 400, 'VALIDATION_FAILED');
      expect(character.body.error.details.fields[0].field).toBe('credits.0.characterName');
      const duplicate = await put([
        { personId: writer.id, role: 'writer' },
        { personId: writer.id, role: 'writer' },
      ]);
      expectError(duplicate, 400, 'VALIDATION_FAILED');
      expect(duplicate.body.error.details.fields[0].field).toBe('credits');
      expect((await get(`${MOVIES}/${movie.id}`)).body.credits).toEqual([]);

      const counts = (await auditOf(movie.id))
        .filter((row) => row.action === 'movie.credits_replaced')
        .map((row) => row.metadata);
      expect(counts).toEqual([{ count: 3 }, { count: 2 }, { count: 0 }]);
    });
  });

  describe('DELETE /admin/movies/{id}', () => {
    it('deletes a movie with its genres, credits and videos', async () => {
      const movie = await createPublishedMovie(testApp, admin, { genres: ['action', 'drama'] });
      const person = await createPerson(testApp, admin);
      expectStatus(
        await adminWrite(testApp, admin, 'put', `${MOVIES}/${movie.id}/credits`).send({
          credits: [{ personId: person.id, role: 'actor' }],
        }),
        200,
      );
      expectStatus(await addVideo(movie.id, 'CCCCCCCCCCC'), 201);

      const response = await adminWrite(testApp, admin, 'delete', `${MOVIES}/${movie.id}`);
      expect(response.status).toBe(204);
      for (const table of ['movies', 'movie_genres', 'movie_credits', 'movie_videos']) {
        const column = table === 'movies' ? 'id' : 'movie_id';
        expect(await testApp.knex(table).where({ [column]: movie.id })).toEqual([]);
      }
      expect((await testApp.knex('people').where({ id: person.id })).length).toBe(1);
      const [deleted] = (await auditOf(movie.id)).filter((row) => row.action === 'movie.deleted');
      expect(deleted!.metadata).toEqual({ photoCount: 0, videoCount: 1, creditCount: 1 });
    });

    it('refuses a movie a registered blocker protects, and deletes nothing', async () => {
      const movie = await createPublishedMovie(testApp, admin);
      const blocker = testApp.app.get(TestBookingsBlocker);
      blocker.bookedMovieIds.add(movie.id);
      try {
        const response = await adminWrite(testApp, admin, 'delete', `${MOVIES}/${movie.id}`);
        expectError(response, 409, 'MOVIE_NOT_DELETABLE');
        expect(response.body.error.details).toEqual({ reasons: ['has_bookings'] });
        expect((await get(`${MOVIES}/${movie.id}`)).status).toBe(200);
      } finally {
        blocker.bookedMovieIds.delete(movie.id);
      }
      expectError(await adminWrite(testApp, admin, 'delete', `${MOVIES}/987654`), 404, 'NOT_FOUND');
    });
  });

  describe('GET /admin/movies', () => {
    beforeAll(async () => {
      await testApp.knex.raw('TRUNCATE TABLE movies RESTART IDENTITY CASCADE');
    });

    it('pages newest first with total and status counts, searching titles and cast', async () => {
      const lighthouse = await createDraftMovie(testApp, admin, { title: 'The Last Lighthouse' });
      const cast = await createPerson(testApp, admin, { fullName: 'Karim Fahmy' });
      const signal = await createPublishedMovie(testApp, admin, { title: 'Desert Signal' });
      expectStatus(
        await adminWrite(testApp, admin, 'put', `${MOVIES}/${signal.id}/credits`).send({
          credits: [{ personId: cast.id, role: 'actor' }],
        }),
        200,
      );
      const percent = await createDraftMovie(testApp, admin, { title: '100% Cotton' });
      for (let index = 0; index < 22; index += 1) {
        clock.advance({ seconds: 1 });
        await createDraftMovie(testApp, admin, {
          title: `Filler ${String(index).padStart(2, '0')}`,
        });
      }

      const firstPage = await get(MOVIES);
      expect(firstPage.status).toBe(200);
      expect(firstPage.body.total).toBe(25);
      expect(firstPage.body.items).toHaveLength(20);
      expect(firstPage.body.items[0].title).toBe('Filler 21');
      expect(firstPage.body.statusCounts).toEqual({
        draft: 24,
        comingSoon: 0,
        nowShowing: 1,
        archived: 0,
      });
      const secondPage = await get(`${MOVIES}?cursor=${firstPage.body.nextCursor}`);
      expect(secondPage.body.items).toHaveLength(5);
      expect(secondPage.body.nextCursor).toBeNull();
      const ids = [...firstPage.body.items, ...secondPage.body.items].map(
        (item: { id: number }) => item.id,
      );
      expect(new Set(ids).size).toBe(25);
      expect(ids.slice(-3)).toEqual([percent.id, signal.id, lighthouse.id]);

      const byTitle = await get(`${MOVIES}?q=LIGHTH`);
      expect(idsOf(byTitle.body.items)).toEqual([lighthouse.id]);
      const byCast = await get(`${MOVIES}?q=fahm`);
      expect(idsOf(byCast.body.items)).toEqual([signal.id]);
      expect(byCast.body.items[0]).toEqual(
        expect.objectContaining({ creditCount: 1, videoCount: 0, photoCount: 0 }),
      );
      expect(byCast.body.statusCounts).toEqual({
        draft: 0,
        comingSoon: 0,
        nowShowing: 1,
        archived: 0,
      });
      const literal = await get(`${MOVIES}?q=${encodeURIComponent('0%')}`);
      expect(idsOf(literal.body.items)).toEqual([percent.id]);
      const drafts = await get(`${MOVIES}?status=now_showing`);
      expect(drafts.body.total).toBe(1);
      expect(drafts.body.statusCounts.draft).toBe(24);

      expectError(await get(`${MOVIES}?q=a`), 400, 'VALIDATION_FAILED');
      expectError(await get(`${MOVIES}?cursor=WyJ4IiwxXQ`), 400, 'VALIDATION_FAILED');
    });

    it('costs the same number of queries for one movie and for many', async () => {
      const countQueries = async (path: string): Promise<number> => {
        let count = 0;
        const listener = (): void => {
          count += 1;
        };
        testApp.knex.on('query', listener);
        try {
          expectStatus(await get(path), 200);
        } finally {
          testApp.knex.removeListener('query', listener);
        }
        return count;
      };
      const one = await countQueries(`${MOVIES}?limit=1`);
      const many = await countQueries(`${MOVIES}?limit=20`);
      expect(many).toBe(one);
    });
  });

  describe('access', () => {
    it('every catalog admin route refuses a box-office token with FORBIDDEN and no token with UNAUTHENTICATED', async () => {
      const boxOffice = await staffSession(testApp, 'box_office');
      const routes = listHttpRoutes(testApp).filter(
        (route) =>
          route.path.startsWith('/api/v1/admin/movies') ||
          route.path.startsWith('/api/v1/admin/people'),
      );
      expect(routes.map((route) => `${route.method} ${route.path}`).sort()).toEqual(
        [
          'GET /api/v1/admin/movies',
          'POST /api/v1/admin/movies',
          'PATCH /api/v1/admin/movies',
          'GET /api/v1/admin/movies/:id',
          'PATCH /api/v1/admin/movies/:id',
          'DELETE /api/v1/admin/movies/:id',
          'PUT /api/v1/admin/movies/:id/credits',
          'PUT /api/v1/admin/movies/:id/poster',
          'DELETE /api/v1/admin/movies/:id/poster',
          'POST /api/v1/admin/movies/:id/photos',
          'PATCH /api/v1/admin/movies/:id/photos/:photoId',
          'DELETE /api/v1/admin/movies/:id/photos/:photoId',
          'POST /api/v1/admin/movies/:id/videos',
          'PATCH /api/v1/admin/movies/:id/videos/:videoId',
          'DELETE /api/v1/admin/movies/:id/videos/:videoId',
          'GET /api/v1/admin/people',
          'POST /api/v1/admin/people',
          'GET /api/v1/admin/people/:id',
          'PATCH /api/v1/admin/people/:id',
          'DELETE /api/v1/admin/people/:id',
          'PUT /api/v1/admin/people/:id/photo',
          'DELETE /api/v1/admin/people/:id/photo',
          'PUT /api/v1/admin/people/:id/credits',
        ].sort(),
      );
      expect(routes.every((route) => route.access === 'admin')).toBe(true);

      for (const route of routes) {
        const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
        const forbidden = await testApp
          .http()
          [method](samplePath(route.path))
          .set('Authorization', boxOffice.authorization)
          .set('Idempotency-Key', randomUUID())
          .send({});
        expect({
          route: route.handler,
          status: forbidden.status,
          code: forbidden.body?.error?.code,
        }).toEqual({
          route: route.handler,
          status: 403,
          code: 'FORBIDDEN',
        });
        const anonymous = await testApp.http()[method](samplePath(route.path)).send({});
        expect({
          route: route.handler,
          status: anonymous.status,
          code: anonymous.body?.error?.code,
        }).toEqual({
          route: route.handler,
          status: 401,
          code: 'UNAUTHENTICATED',
        });
      }
    });
  });

  describe('the activity log', () => {
    it('holds field names and ids only: no title, name, synopsis or link', async () => {
      const rows = await testApp.knex('audit_events').select('changed_fields', 'metadata');
      const text = JSON.stringify(rows);
      for (const value of [
        'Lighthouse',
        'Desert',
        'Karim',
        'Fahmy',
        'signal from',
        'youtube.com',
        'EGP 48M',
      ]) {
        expect(text).not.toContain(value);
      }
      expect(rows.length).toBeGreaterThan(20);
    });
  });
});
