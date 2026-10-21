import type { Response } from 'supertest';
import { formatCairoIso } from '../../../../src/common/time/time';
import { TestClock } from '../../../support/clock';
import {
  adminWrite,
  createDraftMovie,
  createPerson,
  expectStatus,
  idsOf,
} from '../../../support/catalog';
import { png } from '../../../support/media-fixtures';
import { mediaDirectory, removeMediaDirectory, storedFiles } from '../../../support/media';
import { waitForLockWaiters } from '../../../support/database';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { buildTestConfig } from '../../../support/test-config';
import type { StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(60_000);

const MOVIES = '/api/v1/admin/movies';
const PEOPLE = '/api/v1/admin/people';

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

interface CreditBody {
  id: number;
  role: string;
  characterName: string | null;
  position: number;
  person: { id: number; fullName: string };
}

describe('Admin people routes (integration)', () => {
  let testApp: TestApp;
  let directory: string;
  let admin: StaffSession;
  const clock = new TestClock(new Date('2026-10-16T12:00:00Z'));

  beforeAll(async () => {
    directory = await mediaDirectory();
    testApp = await createTestApp({
      clock,
      config: buildTestConfig({}, { LOCAL_STORAGE_DIR: directory }),
    });
    admin = await staffSession(testApp, 'admin');
  });

  afterAll(async () => {
    await testApp.close();
    await removeMediaDirectory(directory);
  });

  const get = (path: string) => testApp.http().get(path).set('Authorization', admin.authorization);
  const patchPerson = (id: number, body: object) =>
    adminWrite(testApp, admin, 'patch', `${PEOPLE}/${id}`).send(body);
  const putMovieCredits = (movieId: number, credits: object[]) =>
    adminWrite(testApp, admin, 'put', `${MOVIES}/${movieId}/credits`).send({ credits });
  const putPersonCredits = (personId: number, credits: object[]) =>
    adminWrite(testApp, admin, 'put', `${PEOPLE}/${personId}/credits`).send({ credits });
  const movieCredits = async (movieId: number): Promise<CreditBody[]> =>
    (await get(`${MOVIES}/${movieId}`)).body.credits as CreditBody[];
  const putPhoto = (personId: number, file: Buffer) =>
    testApp
      .http()
      .put(`${PEOPLE}/${personId}/photo`)
      .set('Authorization', admin.authorization)
      .attach('file', file, 'person.png');

  describe('create and edit', () => {
    it('creates a person with set roles and links, and edits them', async () => {
      const response = await adminWrite(testApp, admin, 'post', PEOPLE).send({
        fullName: ' Hala Nour ',
        birthDate: '1980-02-29',
        roles: ['writer', 'director'],
        imdbUrl: 'https://www.imdb.com/name/nm0000001/',
      });
      expect(response.status).toBe(201);
      expect(response.body).toEqual(
        expect.objectContaining({
          fullName: 'Hala Nour',
          birthDate: '1980-02-29',
          roles: ['director', 'writer'],
          creditedRoles: [],
          credits: [],
          photo: null,
          imdbUrl: 'https://www.imdb.com/name/nm0000001/',
          instagramUrl: null,
          createdAt: '2026-10-16T15:00:00+03:00',
        }),
      );

      const edited = await patchPerson(response.body.id, {
        bio: 'Writer and director.',
        instagramUrl: 'https://instagram.com/hala',
        websiteUrl: 'https://hala.example',
        roles: ['director'],
      });
      expect(edited.status).toBe(200);
      expect(edited.body).toEqual(
        expect.objectContaining({
          bio: 'Writer and director.',
          instagramUrl: 'https://instagram.com/hala',
          websiteUrl: 'https://hala.example',
          roles: ['director'],
        }),
      );
      const [audit] = await testApp
        .knex('audit_events')
        .select('changed_fields')
        .where({ action: 'person.updated', entity_id: response.body.id });
      expect(audit.changed_fields).toEqual(['bio', 'instagramUrl', 'roles', 'websiteUrl']);

      const same = await patchPerson(response.body.id, {
        roles: ['director'],
        bio: 'Writer and director.',
      });
      expect(same.status).toBe(200);
      const updates = await testApp
        .knex('audit_events')
        .where({ action: 'person.updated', entity_id: response.body.id });
      expect(updates).toHaveLength(1);
    });

    it('refuses bad input and unknown people', async () => {
      const person = await createPerson(testApp, admin);
      const future = await patchPerson(person.id, { birthDate: '2026-10-17' });
      expectError(future, 400, 'VALIDATION_FAILED');
      expect(future.body.error.details.fields[0].field).toBe('birthDate');
      const wrongHost = await patchPerson(person.id, { instagramUrl: 'https://imdb.com/x' });
      expect(wrongHost.body.error.details.fields[0].field).toBe('instagramUrl');
      expectError(
        await patchPerson(person.id, { websiteUrl: 'http://plain.example' }),
        400,
        'VALIDATION_FAILED',
      );
      expectError(await patchPerson(person.id, { fullName: null }), 400, 'VALIDATION_FAILED');
      expectError(await patchPerson(person.id, {}), 400, 'VALIDATION_FAILED');
      expectError(await patchPerson(987654, { bio: 'x' }), 404, 'NOT_FOUND');
      expectError(await get(`${PEOPLE}/987654`), 404, 'NOT_FOUND');
    });

    it("takes a birth date up to today's calendar date in Cairo, even before 06:00", async () => {
      const person = await createPerson(testApp, admin);
      const saved = clock.now();
      // 01:30 on 17 October in Cairo (UTC+3): still the 16th's cinema day, but the 17th's date.
      clock.set(new Date('2026-10-16T22:30:00Z'));
      try {
        const late = await staffSession(testApp, 'admin');
        const patchLate = (birthDate: string) =>
          adminWrite(testApp, late, 'patch', `${PEOPLE}/${person.id}`).send({ birthDate });
        const today = await patchLate('2026-10-17');
        expect(today.status).toBe(200);
        expect(today.body.birthDate).toBe('2026-10-17');
        const tomorrow = await patchLate('2026-10-18');
        expectError(tomorrow, 400, 'VALIDATION_FAILED');
        expect(tomorrow.body.error.details.fields[0].field).toBe('birthDate');
      } finally {
        clock.set(saved);
      }
    });

    it('refuses null roles, which are cleared with [], and keeps the set roles', async () => {
      const person = await createPerson(testApp, admin, { roles: ['actor', 'director'] });

      const response = await patchPerson(person.id, { roles: null });

      expectError(response, 400, 'VALIDATION_FAILED');
      expect(response.body.error.details.fields[0].field).toBe('roles');
      expect((await get(`${PEOPLE}/${person.id}`)).body.roles).toEqual(['actor', 'director']);
    });
  });

  describe('PUT /admin/people/{id}/credits', () => {
    it('adds credits last in each movie, keeps their place, and is found by role group', async () => {
      const [first, second] = await Promise.all([
        createDraftMovie(testApp, admin),
        createDraftMovie(testApp, admin),
      ]);
      const [lead, director, newcomer] = await Promise.all([
        createPerson(testApp, admin, { fullName: 'Aaa Lead' }),
        createPerson(testApp, admin, { fullName: 'Bbb Director', roles: ['director'] }),
        createPerson(testApp, admin, { fullName: 'Ccc Newcomer' }),
      ]);
      expectStatus(
        await putMovieCredits(first.id, [
          { personId: lead.id, role: 'actor' },
          { personId: director.id, role: 'director' },
        ]),
        200,
      );
      expectStatus(await putMovieCredits(second.id, [{ personId: lead.id, role: 'actor' }]), 200);
      clock.advance({ minutes: 1 });

      const response = await putPersonCredits(newcomer.id, [
        { movieId: first.id, role: 'actor', characterName: 'The guard' },
        { movieId: second.id, role: 'actor' },
      ]);
      expect(response.status).toBe(200);
      expect(response.body.creditedRoles).toEqual(['actor']);
      expect(response.body.credits).toHaveLength(2);
      expect(
        (await movieCredits(first.id)).map((credit) => [
          credit.person.id,
          credit.role,
          credit.position,
        ]),
      ).toEqual([
        [lead.id, 'actor', 0],
        [director.id, 'director', 1],
        [newcomer.id, 'actor', 2],
      ]);
      expect(
        (await movieCredits(second.id)).map((credit) => [credit.person.id, credit.position]),
      ).toEqual([
        [lead.id, 0],
        [newcomer.id, 1],
      ]);
      const touched = await testApp
        .knex('movies')
        .select<{ updated_at: Date }[]>('updated_at')
        .whereIn('id', [first.id, second.id]);
      expect(touched.map((row) => row.updated_at.toISOString())).toEqual([
        '2026-10-16T12:01:00.000Z',
        '2026-10-16T12:01:00.000Z',
      ]);

      // The lead keeps first place in movie one, takes a new character name, leaves movie two.
      const kept = await putPersonCredits(lead.id, [
        { movieId: first.id, role: 'actor', characterName: 'Youssef' },
      ]);
      expect(kept.status).toBe(200);
      expect(
        (await movieCredits(first.id)).map((credit) => [
          credit.person.id,
          credit.characterName,
          credit.position,
        ]),
      ).toEqual([
        [lead.id, 'Youssef', 0],
        [director.id, null, 1],
        [newcomer.id, 'The guard', 2],
      ]);
      expect(
        (await movieCredits(second.id)).map((credit) => [credit.person.id, credit.position]),
      ).toEqual([[newcomer.id, 0]]);

      const actors = await get(`${PEOPLE}?roleGroup=actors`);
      expect(idsOf(actors.body.items)).toEqual(expect.arrayContaining([lead.id, newcomer.id]));
      expect(idsOf(actors.body.items)).not.toContain(director.id);
      const directors = await get(`${PEOPLE}?roleGroup=directors`);
      expect(idsOf(directors.body.items)).toContain(director.id);

      const unknown = await putPersonCredits(newcomer.id, [{ movieId: 999999, role: 'actor' }]);
      expectError(unknown, 400, 'VALIDATION_FAILED');
      expect(unknown.body.error.details.fields).toEqual([
        { field: 'credits.0.movieId', messages: ['movieId must name an existing movie'] },
      ]);
      const [audit] = await testApp
        .knex('audit_events')
        .select('metadata')
        .where({ action: 'person.credits_replaced', entity_id: newcomer.id });
      expect(audit.metadata).toEqual({ count: 2, movieCount: 2 });
    });

    it('leaves the "Last edited by" of movies whose credits it doesn\'t change', async () => {
      const [untouched, renamed, added] = await Promise.all([
        createDraftMovie(testApp, admin),
        createDraftMovie(testApp, admin),
        createDraftMovie(testApp, admin),
      ]);
      const person = await createPerson(testApp, admin);
      expectStatus(
        await putPersonCredits(person.id, [
          { movieId: untouched.id, role: 'director' },
          { movieId: renamed.id, role: 'actor', characterName: 'Before' },
        ]),
        200,
      );
      const before = await get(`${MOVIES}/${untouched.id}`);
      const other = await staffSession(testApp, 'admin');
      clock.advance({ minutes: 3 });

      const response = await adminWrite(
        testApp,
        other,
        'put',
        `${PEOPLE}/${person.id}/credits`,
      ).send({
        credits: [
          { movieId: untouched.id, role: 'director' },
          { movieId: renamed.id, role: 'actor', characterName: 'After' },
          { movieId: added.id, role: 'writer' },
        ],
      });
      expect(response.status).toBe(200);

      const after = await get(`${MOVIES}/${untouched.id}`);
      expect([after.body.updatedAt, after.body.updatedBy]).toEqual([
        before.body.updatedAt,
        before.body.updatedBy,
      ]);
      for (const movie of [renamed, added]) {
        const changed = await get(`${MOVIES}/${movie.id}`);
        expect([changed.body.updatedAt, changed.body.updatedBy.id]).toEqual([
          formatCairoIso(clock.now()),
          other.staffUserId,
        ]);
      }
    });

    it('renumbers a movie whose credit it removes after that credit was added meanwhile', async () => {
      const [waitedOn, creditedMeanwhile] = await Promise.all([
        createDraftMovie(testApp, admin),
        createDraftMovie(testApp, admin),
      ]);
      const [person, stays] = await Promise.all([
        createPerson(testApp, admin),
        createPerson(testApp, admin),
      ]);
      expectStatus(
        await putMovieCredits(waitedOn.id, [{ personId: person.id, role: 'actor' }]),
        200,
      );

      // Hold the movie the replace reads first, so it waits after reading the person's movies.
      const blocker = await testApp.knex.transaction();
      await blocker('movies').select('id').where({ id: waitedOn.id }).forUpdate();
      const replace = putPersonCredits(person.id, [{ movieId: waitedOn.id, role: 'actor' }]).then(
        (response) => response,
      );
      await waitForLockWaiters(testApp.knex, 1);
      expectStatus(
        await putMovieCredits(creditedMeanwhile.id, [
          { personId: person.id, role: 'director' },
          { personId: stays.id, role: 'writer' },
        ]),
        200,
      );
      clock.advance({ minutes: 2 });
      await blocker.commit();
      expect((await replace).status).toBe(200);

      expect(
        (await movieCredits(creditedMeanwhile.id)).map((credit) => [
          credit.person.id,
          credit.position,
        ]),
      ).toEqual([[stays.id, 0]]);
      const [touched] = await testApp
        .knex('movies')
        .select<{ updated_at: Date }[]>('updated_at')
        .where({ id: creditedMeanwhile.id });
      expect(touched!.updated_at.toISOString()).toBe(clock.now().toISOString());
    });
  });

  describe('DELETE /admin/people/{id}', () => {
    it('removes the person, their roles, every credit and their photo files', async () => {
      const [first, second] = await Promise.all([
        createDraftMovie(testApp, admin),
        createDraftMovie(testApp, admin),
      ]);
      const [gone, stays] = await Promise.all([
        createPerson(testApp, admin, { roles: ['actor'] }),
        createPerson(testApp, admin),
      ]);
      expectStatus(
        await putMovieCredits(first.id, [
          { personId: gone.id, role: 'actor' },
          { personId: stays.id, role: 'writer' },
        ]),
        200,
      );
      expectStatus(
        await putMovieCredits(second.id, [
          { personId: stays.id, role: 'actor' },
          { personId: gone.id, role: 'director' },
          { personId: stays.id, role: 'writer' },
        ]),
        200,
      );
      expectStatus(await putPhoto(gone.id, await png(600, 600)), 200);
      const imageId = (
        await testApp.knex('people').select('photo_image_id').where({ id: gone.id })
      )[0].photo_image_id as number;
      const prefix = (
        await testApp.knex('images').select('storage_prefix').where({ id: imageId })
      )[0].storage_prefix as string;
      clock.advance({ minutes: 2 });

      const response = await adminWrite(testApp, admin, 'delete', `${PEOPLE}/${gone.id}`);
      expect(response.status).toBe(204);
      expect(await testApp.knex('movie_credits').where({ person_id: gone.id })).toEqual([]);
      expect(await testApp.knex('person_roles').where({ person_id: gone.id })).toEqual([]);
      expect(await testApp.knex('people').where({ id: gone.id })).toEqual([]);
      expect(
        (await movieCredits(first.id)).map((credit) => [credit.person.id, credit.position]),
      ).toEqual([[stays.id, 0]]);
      expect(
        (await movieCredits(second.id)).map((credit) => [
          credit.person.id,
          credit.role,
          credit.position,
        ]),
      ).toEqual([
        [stays.id, 'actor', 0],
        [stays.id, 'writer', 1],
      ]);
      const touched = await testApp
        .knex('movies')
        .select<{ updated_at: Date }[]>('updated_at')
        .whereIn('id', [first.id, second.id]);
      expect(
        touched.every((row) => row.updated_at.toISOString() === clock.now().toISOString()),
      ).toBe(true);
      expect(await testApp.knex('images').where({ id: imageId })).toEqual([]);
      expect((await storedFiles(directory)).some((path) => path.startsWith(prefix))).toBe(false);
      const [audit] = await testApp
        .knex('audit_events')
        .select('metadata')
        .where({ action: 'person.deleted', entity_id: gone.id });
      expect(audit.metadata).toEqual({ creditCount: 2 });
      expectError(
        await adminWrite(testApp, admin, 'delete', `${PEOPLE}/${gone.id}`),
        404,
        'NOT_FOUND',
      );
    });

    it('renumbers a movie that credited the person while the delete waited for its locks', async () => {
      const [waitedOn, creditedMeanwhile] = await Promise.all([
        createDraftMovie(testApp, admin),
        createDraftMovie(testApp, admin),
      ]);
      const [gone, stays] = await Promise.all([
        createPerson(testApp, admin),
        createPerson(testApp, admin),
      ]);
      expectStatus(await putMovieCredits(waitedOn.id, [{ personId: gone.id, role: 'actor' }]), 200);

      // Hold the movie the delete reads first, so it waits after reading the person's movies.
      const blocker = await testApp.knex.transaction();
      await blocker('movies').select('id').where({ id: waitedOn.id }).forUpdate();
      const deletion = adminWrite(testApp, admin, 'delete', `${PEOPLE}/${gone.id}`).then(
        (response) => response,
      );
      await waitForLockWaiters(testApp.knex, 1);
      expectStatus(
        await putMovieCredits(creditedMeanwhile.id, [
          { personId: gone.id, role: 'director' },
          { personId: stays.id, role: 'writer' },
        ]),
        200,
      );
      clock.advance({ minutes: 2 });
      await blocker.commit();
      expect((await deletion).status).toBe(204);

      expect(
        (await movieCredits(creditedMeanwhile.id)).map((credit) => [
          credit.person.id,
          credit.position,
        ]),
      ).toEqual([[stays.id, 0]]);
      const [touched] = await testApp
        .knex('movies')
        .select<{ updated_at: Date }[]>('updated_at')
        .where({ id: creditedMeanwhile.id });
      expect(touched!.updated_at.toISOString()).toBe(clock.now().toISOString());
      const [audit] = await testApp
        .knex('audit_events')
        .select('metadata')
        .where({ action: 'person.deleted', entity_id: gone.id });
      expect(audit.metadata).toEqual({ creditCount: 2 });
    });
  });

  describe('the photo', () => {
    it('takes a square photo of at least 600 × 600, replaces and removes it', async () => {
      const person = await createPerson(testApp, admin, { fullName: 'Rana Lotfy' });
      const set = await putPhoto(person.id, await png(600, 600));
      expect(set.status).toBe(200);
      expect(set.body.photo.alt).toBe('Rana Lotfy');
      expect(
        (set.body.photo.variants as { width: number }[]).map((variant) => variant.width),
      ).toEqual([150, 300, 600]);
      const small = await putPhoto(person.id, await png(599, 599));
      expectError(small, 422, 'IMAGE_WRONG_SHAPE');
      const wide = await putPhoto(person.id, await png(900, 600));
      expectError(wide, 422, 'IMAGE_WRONG_SHAPE');

      expectStatus(await putPhoto(person.id, await png(800, 800, '#225588')), 200);
      expect(await testApp.knex('images').where({ kind: 'person' })).toHaveLength(1);
      expectStatus(await adminWrite(testApp, admin, 'delete', `${PEOPLE}/${person.id}/photo`), 204);
      expect((await get(`${PEOPLE}/${person.id}`)).body.photo).toBeNull();
      expectStatus(await adminWrite(testApp, admin, 'delete', `${PEOPLE}/${person.id}/photo`), 204);
      expectError(await putPhoto(987654, await png(600, 600)), 404, 'NOT_FOUND');
    });
  });

  describe('GET /admin/people', () => {
    beforeAll(async () => {
      await testApp.knex.raw('TRUNCATE TABLE people, movies RESTART IDENTITY CASCADE');
    });

    it('lists by name with roles, credit counts, birth year and what they are known for', async () => {
      const zed = await createPerson(testApp, admin, {
        fullName: 'Zed Amr',
        birthDate: '1975-06-01',
      });
      const amal = await createPerson(testApp, admin, {
        fullName: 'Amal Fahmy',
        roles: ['writer'],
      });
      const omar = await createPerson(testApp, admin, { fullName: 'Omar Fahmy' });
      const old = await createDraftMovie(testApp, admin, {
        title: 'Old Film',
        releaseDate: '2001-01-01',
      });
      const recent = await createDraftMovie(testApp, admin, {
        title: 'Recent Film',
        releaseDate: '2025-05-05',
      });
      const undated = await createDraftMovie(testApp, admin, { title: 'Undated Film' });
      for (const movie of [old, recent, undated]) {
        expectStatus(await putMovieCredits(movie.id, [{ personId: zed.id, role: 'actor' }]), 200);
      }
      expectStatus(
        await putMovieCredits(recent.id, [
          { personId: zed.id, role: 'actor' },
          { personId: zed.id, role: 'producer' },
        ]),
        200,
      );

      const page = await get(`${PEOPLE}?limit=2`);
      expect(page.status).toBe(200);
      expect(page.body.total).toBe(3);
      expect((page.body.items as { fullName: string }[]).map((item) => item.fullName)).toEqual([
        'Amal Fahmy',
        'Omar Fahmy',
      ]);
      const next = await get(`${PEOPLE}?limit=2&cursor=${page.body.nextCursor}`);
      expect(next.body.items).toEqual([
        {
          id: zed.id,
          fullName: 'Zed Amr',
          photo: null,
          roles: ['actor', 'producer'],
          birthYear: 1975,
          birthPlace: null,
          creditCount: 4,
          knownFor: [
            { id: recent.id, title: 'Recent Film' },
            { id: old.id, title: 'Old Film' },
          ],
        },
      ]);
      expect(next.body.nextCursor).toBeNull();
      expect(page.body.items[0].roles).toEqual(['writer']);

      const fahmy = await get(`${PEOPLE}?q=FAHMY`);
      expect(idsOf(fahmy.body.items)).toEqual([amal.id, omar.id]);
      const crew = await get(`${PEOPLE}?roleGroup=crew`);
      expect(idsOf(crew.body.items)).toEqual([zed.id]);
      const writers = await get(`${PEOPLE}?roleGroup=writers`);
      expect(idsOf(writers.body.items)).toEqual([amal.id]);
      expectError(await get(`${PEOPLE}?roleGroup=extras`), 400, 'VALIDATION_FAILED');

      const filmography = await get(`${PEOPLE}/${zed.id}`);
      expect(
        (filmography.body.credits as { role: string; movie: { title: string } }[]).map((credit) => [
          credit.movie.title,
          credit.role,
        ]),
      ).toEqual([
        ['Recent Film', 'actor'],
        ['Recent Film', 'producer'],
        ['Old Film', 'actor'],
        ['Undated Film', 'actor'],
      ]);
    });
  });
});
