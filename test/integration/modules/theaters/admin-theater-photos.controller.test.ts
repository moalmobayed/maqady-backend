import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { jpeg, png } from '../../../support/media-fixtures';
import { mediaDirectory, removeMediaDirectory, storedFiles } from '../../../support/media';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { buildTestConfig } from '../../../support/test-config';
import { createTheater, THEATERS } from '../../../support/theaters';
import type { StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(60_000);

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

interface PhotoBody {
  id: number;
  caption: string | null;
  position: number;
  image: { alt: string | null; variants: { name: string; url: string; width: number }[] };
}

describe('Admin theater photos through the real image pipeline (integration, local storage)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let directory: string;
  let theaterId: number;
  let gallery: Buffer;
  let cover: Buffer;

  const upload = (
    file: Buffer,
    fields: Record<string, string>,
    key: string | null = randomUUID(),
    id = theaterId,
  ) => {
    const request = testApp
      .http()
      .post(`${THEATERS}/${id}/photos`)
      .set('Authorization', admin.authorization);
    if (key !== null) request.set('Idempotency-Key', key);
    for (const [name, value] of Object.entries(fields)) request.field(name, value);
    return request.attach('file', file, 'photo.jpg');
  };
  const prefixes = async () => [
    ...new Set((await storedFiles(directory)).map((path) => path.split('/').slice(0, 2).join('/'))),
  ];
  const photosOf = (response: Response) => response.body.photos as PhotoBody[];

  beforeAll(async () => {
    directory = await mediaDirectory();
    testApp = await createTestApp({
      config: buildTestConfig({}, { LOCAL_STORAGE_DIR: directory }),
    });
    admin = await staffSession(testApp, 'admin');
    gallery = await jpeg(800, 600);
    cover = await png(1920, 1080);
  });

  beforeEach(async () => {
    await testApp.knex.raw(
      'TRUNCATE theaters, images, audit_events, idempotency_keys RESTART IDENTITY CASCADE',
    );
    await removeMediaDirectory(directory);
    theaterId = await createTheater(testApp, admin.authorization, { name: 'Maqady Zamalek' });
  });

  afterAll(async () => {
    await testApp.close();
    await removeMediaDirectory(directory);
  });

  it('adds a gallery photo as three WebP files served at /media', async () => {
    const response = await upload(gallery, { usage: 'gallery', caption: ' The lobby ' });

    expect(response.status).toBe(201);
    const [photo] = photosOf(response);
    expect(photo).toEqual({
      id: expect.any(Number),
      caption: 'The lobby',
      position: 0,
      image: { alt: 'The lobby', variants: expect.any(Array) },
    });
    expect(photo!.image.variants.map(({ name, width }) => [name, width])).toEqual([
      ['small', 480],
      ['medium', 800],
      ['large', 800],
    ]);
    const files = await storedFiles(directory);
    expect(files).toHaveLength(3);
    expect(
      files.every((path) => /^gallery\/[0-9a-f-]{36}\/(small|medium|large)\.webp$/.test(path)),
    ).toBe(true);

    const served = await testApp.http().get(new URL(photo!.image.variants[0]!.url).pathname);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');

    const [row] = await testApp.knex('images').select('kind', 'created_by_staff_id');
    expect(row).toEqual({ kind: 'gallery', created_by_staff_id: admin.staffUserId });
    expect(
      await testApp
        .knex('audit_events')
        .where({ action: 'theater_photo.created' })
        .count({ count: 'id' })
        .first(),
    ).toEqual({ count: 1 });
  });

  it('sets a 16:9 cover, and a new cover deletes the old files after commit', async () => {
    const first = await upload(cover, { usage: 'cover' });
    expect(first.status).toBe(201);
    expect(first.body.cover).toEqual({
      alt: 'Maqady Zamalek',
      variants: [
        expect.objectContaining({ name: 'small', width: 640, height: 360 }),
        expect.objectContaining({ name: 'medium', width: 1280, height: 720 }),
        expect.objectContaining({ name: 'large', width: 1920, height: 1080 }),
      ],
    });
    const [firstPrefix] = await prefixes();
    expect(firstPrefix).toMatch(/^backdrop\//);

    const second = await upload(await jpeg(2000, 1500), { usage: 'cover' });
    expect(second.status).toBe(201);
    const remaining = await prefixes();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).not.toBe(firstPrefix);
    expect(await testApp.knex('images').count({ count: 'id' }).first()).toEqual({ count: 1 });

    const removed = await testApp
      .http()
      .delete(`${THEATERS}/${theaterId}/cover`)
      .set('Authorization', admin.authorization);
    expect(removed.status).toBe(204);
    expect(await prefixes()).toEqual([]);
    const theater = await testApp
      .http()
      .get(`${THEATERS}/${theaterId}`)
      .set('Authorization', admin.authorization);
    expect(theater.body.cover).toBeNull();
    // Removing a cover that is not there does nothing.
    expect(
      (
        await testApp
          .http()
          .delete(`${THEATERS}/${theaterId}/cover`)
          .set('Authorization', admin.authorization)
      ).status,
    ).toBe(204);
  });

  it('refuses a square cover as the wrong shape and stores nothing', async () => {
    const response = await upload(await jpeg(1000, 1000), { usage: 'cover' });
    expectError(response, 422, 'IMAGE_WRONG_SHAPE');
    expect(await storedFiles(directory)).toEqual([]);
    expect(await testApp.knex('images')).toEqual([]);
  });

  it('reorders the gallery contiguously, and closes the gap a deleted photo leaves', async () => {
    for (const caption of ['A', 'B', 'C']) await upload(gallery, { usage: 'gallery', caption });
    const before = await testApp
      .http()
      .get(`${THEATERS}/${theaterId}`)
      .set('Authorization', admin.authorization);
    const [a, b, c] = photosOf(before);

    const moved = await testApp
      .http()
      .patch(`${THEATERS}/${theaterId}/photos/${c!.id}`)
      .set('Authorization', admin.authorization)
      .send({ position: 0, caption: null });
    expect(moved.status).toBe(200);
    expect(photosOf(moved).map((photo) => [photo.caption, photo.position])).toEqual([
      [null, 0],
      ['A', 1],
      ['B', 2],
    ]);
    expect(photosOf(moved)[0]!.image.alt).toBe('Maqady Zamalek');

    const deleted = await testApp
      .http()
      .delete(`${THEATERS}/${theaterId}/photos/${a!.id}`)
      .set('Authorization', admin.authorization);
    expect(deleted.status).toBe(204);
    const after = await testApp
      .http()
      .get(`${THEATERS}/${theaterId}`)
      .set('Authorization', admin.authorization);
    expect(photosOf(after).map((photo) => [photo.id, photo.position])).toEqual([
      [c!.id, 0],
      [b!.id, 1],
    ]);
    expect(await prefixes()).toHaveLength(2);
  });

  it('refuses a 21st gallery photo and leaves no files behind', async () => {
    for (let index = 0; index < 20; index += 1) {
      expect((await upload(gallery, { usage: 'gallery' })).status).toBe(201);
    }
    const full = await upload(gallery, { usage: 'gallery' });
    expectError(full, 409, 'CONFLICT');
    expect(full.body.error.details).toEqual({ limit: 20 });
    expect(await prefixes()).toHaveLength(20);
  });

  it('needs an Idempotency-Key, and replays a retried upload without storing it twice', async () => {
    expectError(await upload(gallery, { usage: 'gallery' }, null), 400, 'IDEMPOTENCY_KEY_REQUIRED');

    const key = randomUUID();
    const first = await upload(gallery, { usage: 'gallery' }, key);
    const retry = await upload(gallery, { usage: 'gallery' }, key);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body).toEqual(first.body);
    expect(await prefixes()).toHaveLength(1);
  });

  it('answers NOT_FOUND for an unknown theater before any file is written', async () => {
    expectError(await upload(gallery, { usage: 'gallery' }, randomUUID(), 999), 404, 'NOT_FOUND');
    expect(await storedFiles(directory)).toEqual([]);
  });

  it("refuses a caption on a cover, and another theater's photo is NOT_FOUND", async () => {
    expectError(
      await upload(cover, { usage: 'cover', caption: 'Front' }),
      400,
      'VALIDATION_FAILED',
    );
    const { body } = await upload(gallery, { usage: 'gallery' });
    const [photo] = photosOf({ body } as Response);
    const other = await createTheater(testApp, admin.authorization);
    expectError(
      await testApp
        .http()
        .patch(`${THEATERS}/${other}/photos/${photo!.id}`)
        .set('Authorization', admin.authorization)
        .send({ caption: 'Mine now' }),
      404,
      'NOT_FOUND',
    );
  });

  it('deletes a draft with its cover and gallery, rows now and files after commit', async () => {
    await upload(cover, { usage: 'cover' });
    await upload(gallery, { usage: 'gallery' });
    expect(await prefixes()).toHaveLength(2);

    const deleted = await testApp
      .http()
      .delete(`${THEATERS}/${theaterId}`)
      .set('Authorization', admin.authorization);
    expect(deleted.status).toBe(204);
    expect(await testApp.knex('images')).toEqual([]);
    expect(await testApp.knex('theater_photos')).toEqual([]);
    expect(await storedFiles(directory)).toEqual([]);
  });
});
