import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { IDEMPOTENT_REPLAYED_HEADER } from '../../../../src/common/idempotency/idempotency.constants';
import { adminWrite, createDraftMovie, expectStatus } from '../../../support/catalog';
import { jpeg, png } from '../../../support/media-fixtures';
import { mediaDirectory, removeMediaDirectory, storedFiles } from '../../../support/media';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { buildTestConfig } from '../../../support/test-config';
import type { StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(120_000);

const MOVIES = '/api/v1/admin/movies';
const REPLAYED = IDEMPOTENT_REPLAYED_HEADER.toLowerCase();
const ID = 'dQw4w9WgXcQ';

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

interface PhotoBody {
  id: number;
  kind: string;
  caption: string | null;
  position: number;
  isBackdrop: boolean;
  image: { alt: string | null; variants: { name: string; url: string; width: number }[] };
}

interface VideoBody {
  id: number;
  youtubeId: string;
  title: string;
  kind: string;
  durationSeconds: number | null;
  embedUrl: string;
  thumbnailUrl: string;
  watchUrl: string;
  position: number;
  isHero: boolean;
}

describe('Admin movie media routes (integration, local storage)', () => {
  let testApp: TestApp;
  let directory: string;
  let admin: StaffSession;

  beforeAll(async () => {
    directory = await mediaDirectory();
    testApp = await createTestApp({
      config: buildTestConfig({}, { LOCAL_STORAGE_DIR: directory }),
    });
    admin = await staffSession(testApp, 'admin');
  });

  afterAll(async () => {
    await testApp.close();
    await removeMediaDirectory(directory);
  });

  const prefixesOnDisk = async (): Promise<string[]> => [
    ...new Set((await storedFiles(directory)).map((path) => path.split('/').slice(0, 2).join('/'))),
  ];
  const imagePrefix = async (imageId: number): Promise<string> => {
    const row = await testApp
      .knex('images')
      .select<{ storage_prefix: string }[]>('storage_prefix')
      .where({ id: imageId })
      .first();
    return row!.storage_prefix;
  };
  const photoImageId = async (photoId: number): Promise<number> => {
    const row = await testApp
      .knex('movie_photos')
      .select<{ image_id: number }[]>('image_id')
      .where({ id: photoId })
      .first();
    return row!.image_id;
  };
  const uploadPhoto = (
    movieId: number,
    file: Buffer,
    fields: Record<string, string>,
    key = randomUUID(),
  ) => {
    const request = testApp
      .http()
      .post(`${MOVIES}/${movieId}/photos`)
      .set('Authorization', admin.authorization)
      .set('Idempotency-Key', key);
    for (const [name, value] of Object.entries(fields)) request.field(name, value);
    return request.attach('file', file, 'photo.jpg');
  };
  const putPoster = (movieId: number, file: Buffer) =>
    testApp
      .http()
      .put(`${MOVIES}/${movieId}/poster`)
      .set('Authorization', admin.authorization)
      .attach('file', file, 'poster.png');
  const addVideo = (movieId: number, body: object) =>
    adminWrite(testApp, admin, 'post', `${MOVIES}/${movieId}/videos`).send(body);

  describe('YouTube videos', () => {
    it.each([
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?feature=share&v=${ID}&t=42s`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}?si=abc`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube-nocookie.com/embed/${ID}?rel=0`,
      `  HTTPS://WWW.YOUTUBE.COM/watch?v=${ID}  `,
    ])('stores only the video id of %s and derives its URLs', async (url) => {
      const movie = await createDraftMovie(testApp, admin);
      const response = await addVideo(movie.id, {
        url,
        title: ' Official trailer ',
        kind: 'trailer',
        durationSeconds: 134,
      });

      expect(response.status).toBe(201);
      expect(response.body.videos).toEqual([
        {
          id: expect.any(Number),
          youtubeId: ID,
          title: 'Official trailer',
          kind: 'trailer',
          durationSeconds: 134,
          embedUrl: `https://www.youtube-nocookie.com/embed/${ID}`,
          thumbnailUrl: `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`,
          watchUrl: `https://www.youtube.com/watch?v=${ID}`,
          position: 0,
          isHero: false,
        },
      ]);
      const rows = await testApp
        .knex('movie_videos')
        .select('youtube_id', 'title')
        .where({ movie_id: movie.id });
      expect(rows).toEqual([{ youtube_id: ID, title: 'Official trailer' }]);
    });

    it.each([
      'https://vimeo.com/123456',
      `https://youtube.com.evil.example/watch?v=${ID}`,
      ID,
      `https://www.youtube.com/watch?v=${ID}x`,
      'https://www.youtube.com/@channel',
    ])('refuses %s on url and stores nothing', async (url) => {
      const movie = await createDraftMovie(testApp, admin);
      const response = await addVideo(movie.id, { url, title: 'Trailer', kind: 'trailer' });

      expectError(response, 400, 'VALIDATION_FAILED');
      expect(response.body.error.details.fields).toEqual([
        { field: 'url', messages: ["That doesn't look like a YouTube video link."] },
      ]);
      expect(await testApp.knex('movie_videos').where({ movie_id: movie.id })).toEqual([]);
    });

    it('refuses the same video twice, reorders, edits, caps at 20 and deletes', async () => {
      const movie = await createDraftMovie(testApp, admin);
      const ids = Array.from(
        { length: 20 },
        (_, index) => `video${String(index).padStart(6, '0')}`,
      );
      for (const youtubeId of ids) {
        expectStatus(
          await addVideo(movie.id, {
            url: `https://youtu.be/${youtubeId}`,
            title: 'T',
            kind: 'clip',
          }),
          201,
        );
      }
      const twice = await addVideo(movie.id, {
        url: `https://youtu.be/${ids[0]}`,
        title: 'T',
        kind: 'clip',
      });
      expectError(twice, 409, 'CONFLICT');
      const full = await addVideo(movie.id, {
        url: 'https://youtu.be/ZZZZZZZZZZZ',
        title: 'T',
        kind: 'clip',
      });
      expectError(full, 409, 'CONFLICT');
      expect(full.body.error.details).toEqual({ limit: 20 });

      const before = (
        (
          await testApp
            .http()
            .get(`${MOVIES}/${movie.id}`)
            .set('Authorization', admin.authorization)
        ).body.videos as VideoBody[]
      ).map((video) => video.id);
      const moved = await adminWrite(
        testApp,
        admin,
        'patch',
        `${MOVIES}/${movie.id}/videos/${before[5]}`,
      ).send({ position: 0, title: 'Teaser', kind: 'teaser', durationSeconds: null });
      expect(moved.status).toBe(200);
      const after = moved.body.videos as VideoBody[];
      expect(after.map((video) => video.id)).toEqual([
        before[5],
        ...before.filter((id) => id !== before[5]),
      ]);
      expect(after.map((video) => video.position)).toEqual(after.map((_, index) => index));
      expect(after[0]).toEqual(
        expect.objectContaining({ title: 'Teaser', kind: 'teaser', durationSeconds: null }),
      );

      const last = await adminWrite(
        testApp,
        admin,
        'patch',
        `${MOVIES}/${movie.id}/videos/${before[0]}`,
      ).send({ position: 19 });
      expect((last.body.videos as VideoBody[]).at(-1)!.id).toBe(before[0]);

      expectStatus(
        await adminWrite(testApp, admin, 'delete', `${MOVIES}/${movie.id}/videos/${before[1]}`),
        204,
      );
      const remaining = (
        await testApp.http().get(`${MOVIES}/${movie.id}`).set('Authorization', admin.authorization)
      ).body.videos as VideoBody[];
      expect(remaining).toHaveLength(19);
      expect(remaining.map((video) => video.position)).toEqual(remaining.map((_, index) => index));

      const other = await createDraftMovie(testApp, admin);
      expectError(
        await adminWrite(testApp, admin, 'patch', `${MOVIES}/${other.id}/videos/${before[2]}`).send(
          {
            title: 'x',
          },
        ),
        404,
        'NOT_FOUND',
      );
      expectError(
        await adminWrite(testApp, admin, 'delete', `${MOVIES}/${other.id}/videos/${before[2]}`),
        404,
        'NOT_FOUND',
      );
      expectError(
        await testApp
          .http()
          .post(`${MOVIES}/${movie.id}/videos`)
          .set('Authorization', admin.authorization)
          .send({ url: `https://youtu.be/${ID}`, title: 'T', kind: 'clip' }),
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
      );
    });
  });

  describe('fields that cannot be cleared', () => {
    it.each([
      ['kind', { kind: null }],
      ['position', { position: null }],
    ])('refuses null on a video %s and changes nothing', async (field, body) => {
      const movie = await createDraftMovie(testApp, admin);
      expectStatus(
        await addVideo(movie.id, { url: 'https://youtu.be/aaaaaaaaaaa', title: 'A', kind: 'clip' }),
        201,
      );
      const added = await addVideo(movie.id, {
        url: 'https://youtu.be/bbbbbbbbbbb',
        title: 'B',
        kind: 'teaser',
      });
      const second = (expectStatus(added, 201).body.videos as VideoBody[])[1]!;

      const response = await adminWrite(
        testApp,
        admin,
        'patch',
        `${MOVIES}/${movie.id}/videos/${second.id}`,
      ).send(body);

      expectError(response, 400, 'VALIDATION_FAILED');
      expect(
        (response.body.error.details.fields as { field: string }[]).map((entry) => entry.field),
      ).toEqual([field]);
      const rows = await testApp
        .knex('movie_videos')
        .select('youtube_id', 'kind', 'sort_order')
        .where({ movie_id: movie.id })
        .orderBy('sort_order');
      expect(rows).toEqual([
        { youtube_id: 'aaaaaaaaaaa', kind: 'clip', sort_order: 0 },
        { youtube_id: 'bbbbbbbbbbb', kind: 'teaser', sort_order: 1 },
      ]);
    });

    it('refuses null on a photo position and changes nothing', async () => {
      const movie = await createDraftMovie(testApp, admin);
      expectStatus(await uploadPhoto(movie.id, await jpeg(640, 480), { kind: 'still' }), 201);
      const added = await uploadPhoto(movie.id, await jpeg(640, 480), { kind: 'still' });
      const second = (expectStatus(added, 201).body.photos as PhotoBody[])[1]!;

      const response = await adminWrite(
        testApp,
        admin,
        'patch',
        `${MOVIES}/${movie.id}/photos/${second.id}`,
      ).send({ position: null });

      expectError(response, 400, 'VALIDATION_FAILED');
      const rows = await testApp
        .knex('movie_photos')
        .select('id', 'sort_order')
        .where({ movie_id: movie.id })
        .orderBy('sort_order');
      expect(rows.at(1)).toEqual({ id: second.id, sort_order: 1 });
    });
  });

  describe('photos and the backdrop', () => {
    it('uploads a photo through the pipeline, sets it as the backdrop and deletes it', async () => {
      const movie = await createDraftMovie(testApp, admin, { title: 'The Last Lighthouse' });
      const response = await uploadPhoto(movie.id, await jpeg(1600, 900), {
        kind: 'still',
        caption: ' Youssef climbs to the lamp room ',
      });

      expect(response.status).toBe(201);
      const [photo] = response.body.photos as PhotoBody[];
      expect(photo).toEqual(
        expect.objectContaining({
          kind: 'still',
          caption: 'Youssef climbs to the lamp room',
          position: 0,
          isBackdrop: false,
        }),
      );
      expect(photo!.image.alt).toBe('Youssef climbs to the lamp room');
      expect(photo!.image.variants.map((variant) => variant.name)).toEqual([
        'small',
        'medium',
        'large',
      ]);
      const imageId = await photoImageId(photo!.id);
      const prefix = await imagePrefix(imageId);
      expect(prefix).toMatch(/^gallery\/[0-9a-f-]{36}$/);
      expect(await storedFiles(directory)).toEqual(
        expect.arrayContaining(
          ['large', 'medium', 'small'].map((name) => `${prefix}/${name}.webp`),
        ),
      );
      const served = await testApp.http().get(`/media/${prefix}/small.webp`);
      expect(served.status).toBe(200);
      expect(served.headers['content-type']).toBe('image/webp');

      const backdrop = await adminWrite(testApp, admin, 'patch', `${MOVIES}/${movie.id}`).send({
        backdropPhotoId: photo!.id,
      });
      expect(backdrop.status).toBe(200);
      expect(backdrop.body.backdropPhotoId).toBe(photo!.id);
      expect((backdrop.body.photos as PhotoBody[])[0]!.isBackdrop).toBe(true);

      const square = await uploadPhoto(movie.id, await jpeg(1200, 900), {
        kind: 'behind_the_scenes',
      });
      const squareId = (square.body.photos as PhotoBody[])[1]!.id;
      expect((square.body.photos as PhotoBody[])[1]!.image.alt).toBe('The Last Lighthouse');
      const wrongShape = await adminWrite(testApp, admin, 'patch', `${MOVIES}/${movie.id}`).send({
        backdropPhotoId: squareId,
      });
      expectError(wrongShape, 422, 'IMAGE_WRONG_SHAPE');
      expect(wrongShape.body.error.details).toEqual({
        kind: 'backdrop',
        aspect: '16:9',
        minWidth: 1280,
        minHeight: 720,
        width: 1200,
        height: 900,
      });

      const edited = await adminWrite(
        testApp,
        admin,
        'patch',
        `${MOVIES}/${movie.id}/photos/${squareId}`,
      ).send({
        position: 0,
        caption: '',
        kind: 'still',
      });
      expect(
        (edited.body.photos as PhotoBody[]).map((item) => [item.id, item.position, item.caption]),
      ).toEqual([
        [squareId, 0, null],
        [photo!.id, 1, 'Youssef climbs to the lamp room'],
      ]);

      const deleted = await adminWrite(
        testApp,
        admin,
        'delete',
        `${MOVIES}/${movie.id}/photos/${photo!.id}`,
      );
      expect(deleted.status).toBe(204);
      const after = await testApp
        .http()
        .get(`${MOVIES}/${movie.id}`)
        .set('Authorization', admin.authorization);
      expect(after.body.backdropPhotoId).toBeNull();
      expect((after.body.photos as PhotoBody[]).map((item) => [item.id, item.position])).toEqual([
        [squareId, 0],
      ]);
      expect(await testApp.knex('images').where({ id: imageId })).toEqual([]);
      expect(await prefixesOnDisk()).not.toContain(prefix);
    });

    it('requires a key, replays a retried upload once, and checks the movie before any work', async () => {
      const movie = await createDraftMovie(testApp, admin);
      const file = await jpeg(800, 600);
      const noKey = await testApp
        .http()
        .post(`${MOVIES}/${movie.id}/photos`)
        .set('Authorization', admin.authorization)
        .field('kind', 'still')
        .attach('file', file, 'photo.jpg');
      expectError(noKey, 400, 'IDEMPOTENCY_KEY_REQUIRED');

      const key = randomUUID();
      const first = await uploadPhoto(movie.id, file, { kind: 'still' }, key);
      const again = await uploadPhoto(movie.id, file, { kind: 'still' }, key);
      expect(first.status).toBe(201);
      expect(again.status).toBe(201);
      expect(again.headers[REPLAYED]).toBe('true');
      expect(again.body).toEqual(first.body);
      expect(await testApp.knex('movie_photos').where({ movie_id: movie.id })).toHaveLength(1);

      const filesBefore = await storedFiles(directory);
      expectError(await uploadPhoto(987654, file, { kind: 'still' }), 404, 'NOT_FOUND');
      const badKind = await uploadPhoto(movie.id, file, { kind: 'poster' });
      expectError(badKind, 400, 'VALIDATION_FAILED');
      expect(badKind.body.error.details.fields[0].field).toBe('kind');
      expect(await storedFiles(directory)).toEqual(filesBefore);
    });

    it('caps a movie at 30 photos and leaves no files behind for the refused one', async () => {
      const movie = await createDraftMovie(testApp, admin);
      const file = await jpeg(400, 400);
      for (let index = 0; index < 30; index += 1) {
        expectStatus(await uploadPhoto(movie.id, file, { kind: 'still' }), 201);
      }
      const prefixesBefore = await prefixesOnDisk();
      const refused = await uploadPhoto(movie.id, file, { kind: 'still' });
      expectError(refused, 409, 'CONFLICT');
      expect(refused.body.error.details).toEqual({ limit: 30 });
      expect(await prefixesOnDisk()).toEqual(prefixesBefore);
    });
  });

  describe('the poster', () => {
    it('sets a 2:3 poster, replaces it (old files gone), refuses a square and removes it', async () => {
      const movie = await createDraftMovie(testApp, admin, { title: 'Desert Signal' });
      const first = await putPoster(movie.id, await png(800, 1200));
      expect(first.status).toBe(200);
      expect(first.body.poster.alt).toBe('Desert Signal poster');
      const firstImage = (
        await testApp.knex('movies').select('poster_image_id').where({ id: movie.id })
      )[0].poster_image_id as number;
      const firstPrefix = await imagePrefix(firstImage);
      expect(firstPrefix).toMatch(/^poster\//);

      const second = await putPoster(movie.id, await png(400, 600, '#aa3344'));
      expect(second.status).toBe(200);
      expect(await prefixesOnDisk()).not.toContain(firstPrefix);
      expect(await testApp.knex('images').where({ id: firstImage })).toEqual([]);

      const prefixesBefore = await prefixesOnDisk();
      const square = await putPoster(movie.id, await png(1000, 1000));
      expectError(square, 422, 'IMAGE_WRONG_SHAPE');
      expect(await prefixesOnDisk()).toEqual(prefixesBefore);

      const removed = await adminWrite(testApp, admin, 'delete', `${MOVIES}/${movie.id}/poster`);
      expect(removed.status).toBe(204);
      const after = await testApp
        .http()
        .get(`${MOVIES}/${movie.id}`)
        .set('Authorization', admin.authorization);
      expect(after.body.poster).toBeNull();
      expect(await testApp.knex('images').where({ kind: 'poster' })).toEqual([]);
      expectStatus(await adminWrite(testApp, admin, 'delete', `${MOVIES}/${movie.id}/poster`), 204);
      expectError(await putPoster(987654, await png(400, 600)), 404, 'NOT_FOUND');

      const actions = await testApp
        .knex('audit_events')
        .select('action')
        .where({ entity_type: 'movie', entity_id: movie.id })
        .orderBy('id');
      expect(actions.map((row: { action: string }) => row.action)).toEqual([
        'movie.created',
        'movie.poster_replaced',
        'movie.poster_replaced',
        'movie.poster_removed',
      ]);
    });
  });

  describe('deleting a movie with media', () => {
    it('removes every child row, image row and file once committed', async () => {
      const movie = await createDraftMovie(testApp, admin);
      expectStatus(await putPoster(movie.id, await png(400, 600)), 200);
      const withPhoto = expectStatus(
        await uploadPhoto(movie.id, await jpeg(1920, 1080), { kind: 'still' }),
        201,
      );
      const photoId = (withPhoto.body.photos as PhotoBody[])[0]!.id;
      expectStatus(await uploadPhoto(movie.id, await jpeg(500, 500), { kind: 'still' }), 201);
      expectStatus(
        await adminWrite(testApp, admin, 'patch', `${MOVIES}/${movie.id}`).send({
          backdropPhotoId: photoId,
        }),
        200,
      );
      const withVideo = expectStatus(
        await addVideo(movie.id, { url: `https://youtu.be/${ID}`, title: 'T', kind: 'trailer' }),
        201,
      );
      expectStatus(
        await adminWrite(testApp, admin, 'patch', `${MOVIES}/${movie.id}`).send({
          heroVideoId: (withVideo.body.videos as VideoBody[])[0]!.id,
        }),
        200,
      );
      const imageRows = await testApp
        .knex('images')
        .select<{ id: number; storage_prefix: string }[]>('id', 'storage_prefix')
        .whereIn('id', [
          ...(await testApp.knex('movies').select('poster_image_id').where({ id: movie.id })).map(
            (row: { poster_image_id: number }) => row.poster_image_id,
          ),
          ...(
            await testApp.knex('movie_photos').select('image_id').where({ movie_id: movie.id })
          ).map((row: { image_id: number }) => row.image_id),
        ]);
      expect(imageRows).toHaveLength(3);

      expectStatus(await adminWrite(testApp, admin, 'delete', `${MOVIES}/${movie.id}`), 204);
      expect(await testApp.knex('movie_photos').where({ movie_id: movie.id })).toEqual([]);
      expect(await testApp.knex('movie_videos').where({ movie_id: movie.id })).toEqual([]);
      expect(
        await testApp.knex('images').whereIn(
          'id',
          imageRows.map((row) => row.id),
        ),
      ).toEqual([]);
      const onDisk = await prefixesOnDisk();
      for (const row of imageRows) expect(onDisk).not.toContain(row.storage_prefix);
    });
  });
});
