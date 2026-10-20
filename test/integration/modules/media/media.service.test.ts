import { randomBytes, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { AccessTokenService } from '../../../../src/common/auth/access-token.service';
import { IDEMPOTENT_REPLAYED_HEADER } from '../../../../src/common/idempotency/idempotency.constants';
import {
  TestPrincipalResolvers,
  TestPrincipalResolversModule,
} from '../../../support/foundations-probe.module';
import { jpeg, png, textFile } from '../../../support/media-fixtures';
import {
  createMediaProbeTables,
  dropMediaProbeTables,
  MediaProbeModule,
  OWNERS_TABLE,
} from '../../../support/media-probe.module';
import {
  mediaAdmin,
  mediaDirectory,
  removeMediaDirectory,
  storedFiles,
} from '../../../support/media';
import { createTestApp } from '../../../support/test-app';
import { buildTestConfig, TEST_SCHEMA } from '../../../support/test-config';
import type { ImageRow } from '../../../../src/modules/media/types';
import type { TestApp } from '../../../support/types';

const POSTERS = '/api/v1/test-media/posters';
const OWNERS = '/api/v1/test-media/owners';
const REPLAYED = IDEMPOTENT_REPLAYED_HEADER.toLowerCase();

describe('Media uploads, deletes and files (integration, local storage)', () => {
  let testApp: TestApp;
  let directory: string;
  let authorization: string;
  let poster: Buffer;

  const imageRows = () =>
    testApp
      .knex('images')
      .select<ImageRow[]>(
        'id',
        'kind',
        'storage_prefix',
        'variants',
        'source_width',
        'source_height',
        'created_by_staff_id',
      )
      .orderBy('id');

  const prefixesOnDisk = async () => [
    ...new Set((await storedFiles(directory)).map((path) => path.split('/').slice(0, 2).join('/'))),
  ];

  const uploadPoster = (file: Buffer, key: string | null = randomUUID(), name = 'poster.jpg') => {
    const request = testApp.http().post(POSTERS).set('Authorization', authorization);
    if (key !== null) request.set('Idempotency-Key', key);
    return request.attach('file', file, name);
  };

  beforeAll(async () => {
    directory = await mediaDirectory();
    testApp = await createTestApp({
      config: buildTestConfig({}, { LOCAL_STORAGE_DIR: directory }),
      imports: [MediaProbeModule, TestPrincipalResolversModule],
    });
    await createMediaProbeTables(testApp.knex, TEST_SCHEMA);
    authorization = mediaAdmin(testApp).authorization;
    poster = await jpeg(1000, 1500);
  });

  beforeEach(async () => {
    await testApp.knex.raw('TRUNCATE ??, images, idempotency_keys RESTART IDENTITY CASCADE', [
      OWNERS_TABLE,
    ]);
    await rm(join(directory), { recursive: true, force: true });
  });

  afterAll(async () => {
    await dropMediaProbeTables(testApp.knex, TEST_SCHEMA);
    await testApp.close();
    await removeMediaDirectory(directory);
  });

  describe('a successful upload', () => {
    it('stores three WebP variants under one prefix and one images row by the uploader', async () => {
      const response = await uploadPoster(poster);

      expect(response.status).toBe(201);
      expect(response.headers[REPLAYED]).toBeUndefined();
      const rows = await imageRows();
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row).toEqual(
        expect.objectContaining({
          kind: 'poster',
          source_width: 1000,
          source_height: 1500,
          created_by_staff_id: 7,
        }),
      );
      expect(row.storage_prefix).toMatch(/^poster\/[0-9a-f-]{36}$/);
      expect(await storedFiles(directory)).toEqual(
        ['large', 'medium', 'small'].map((name) => `${row.storage_prefix}/${name}.webp`),
      );
      expect(response.body).toEqual({
        imageId: row.id,
        image: {
          alt: 'Probe poster',
          variants: [
            {
              name: 'small',
              url: `http://localhost:3000/media/${row.storage_prefix}/small.webp`,
              width: 200,
              height: 300,
            },
            {
              name: 'medium',
              url: `http://localhost:3000/media/${row.storage_prefix}/medium.webp`,
              width: 400,
              height: 600,
            },
            {
              name: 'large',
              url: `http://localhost:3000/media/${row.storage_prefix}/large.webp`,
              width: 800,
              height: 1200,
            },
          ],
        },
      });
    });

    it('serves each variant read-only at /media with long caching and a cross-origin resource policy', async () => {
      const { body } = await uploadPoster(poster);

      for (const variant of body.image.variants as {
        url: string;
        width: number;
        height: number;
      }[]) {
        const file = await testApp
          .http()
          .get(new URL(variant.url).pathname)
          .buffer(true)
          .parse((res, done) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => done(null, Buffer.concat(chunks)));
          });
        expect(file.status).toBe(200);
        expect(file.headers['content-type']).toBe('image/webp');
        expect(file.headers['cache-control']).toBe('public, max-age=31536000, immutable');
        expect(file.headers['cross-origin-resource-policy']).toBe('cross-origin');
        const metadata = await sharp(file.body as Buffer).metadata();
        expect([metadata.format, metadata.width, metadata.height]).toEqual([
          'webp',
          variant.width,
          variant.height,
        ]);
        expect(metadata.exif).toBeUndefined();
      }
    });

    it('validates the text fields before any image work, and stores them through the link', async () => {
      const tooLong = await testApp
        .http()
        .post(OWNERS)
        .set('Authorization', authorization)
        .set('Idempotency-Key', randomUUID())
        .field('caption', 'x'.repeat(101))
        .attach('file', await jpeg(800, 600), 'a.jpg');
      expect(tooLong.status).toBe(400);
      expect(tooLong.body.error.code).toBe('VALIDATION_FAILED');
      const unknown = await testApp
        .http()
        .post(OWNERS)
        .set('Authorization', authorization)
        .set('Idempotency-Key', randomUUID())
        .field('colour', 'red')
        .attach('file', await jpeg(800, 600), 'a.jpg');
      expect(unknown.status).toBe(400);
      expect(await storedFiles(directory)).toEqual([]);

      const ok = await testApp
        .http()
        .post(OWNERS)
        .set('Authorization', authorization)
        .set('Idempotency-Key', randomUUID())
        .field('caption', 'Opening night')
        .attach('file', await jpeg(800, 600), 'a.jpg');
      expect(ok.status).toBe(201);
      expect(ok.body).toEqual({ ownerId: 1, imageId: 1, caption: 'Opening night' });
      expect(await testApp.knex(OWNERS_TABLE).select('image_id', 'caption')).toEqual([
        { image_id: 1, caption: 'Opening night' },
      ]);
    });
  });

  describe('refused uploads leave no row and no file', () => {
    it.each<[string, () => Promise<Buffer>, string, number, string]>([
      [
        'a text file renamed .jpg',
        () => Promise.resolve(textFile()),
        'poster.jpg',
        415,
        'UNSUPPORTED_IMAGE_TYPE',
      ],
      [
        'an 11 MB file',
        () =>
          Promise.resolve(
            Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), randomBytes(11 * 1024 * 1024)]),
          ),
        'big.jpg',
        413,
        'IMAGE_TOO_LARGE',
      ],
      ['a 42-megapixel PNG', () => png(7000, 6000), 'huge.png', 422, 'IMAGE_TOO_MANY_PIXELS'],
      ['a square poster', () => jpeg(1200, 1200), 'square.jpg', 422, 'IMAGE_WRONG_SHAPE'],
    ])('%s', async (_label, file, name, status, code) => {
      const response = await uploadPoster(await file(), randomUUID(), name);

      expect(response.status).toBe(status);
      expect(response.body.error.code).toBe(code);
      expect(await imageRows()).toEqual([]);
      expect(await storedFiles(directory)).toEqual([]);
      expect(await testApp.knex('idempotency_keys').count({ n: '*' })).toEqual([{ n: 0 }]);
    });

    it('two files, or none, are VALIDATION_FAILED on "file"', async () => {
      const two = await testApp
        .http()
        .post(POSTERS)
        .set('Authorization', authorization)
        .set('Idempotency-Key', randomUUID())
        .attach('file', poster, 'a.jpg')
        .attach('file', poster, 'b.jpg');
      const none = await testApp
        .http()
        .post(POSTERS)
        .set('Authorization', authorization)
        .set('Idempotency-Key', randomUUID())
        .field('caption', 'no file');
      const json = await testApp
        .http()
        .post(POSTERS)
        .set('Authorization', authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ file: 'not a file' });

      for (const response of [two, none, json]) {
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
        expect(response.body.error.details.fields[0].field).toBe('file');
      }
      expect(await imageRows()).toEqual([]);
      expect(await storedFiles(directory)).toEqual([]);
    });

    it('checks access and the strict key before reading the file', async () => {
      const noKey = await uploadPoster(poster, null);
      expect(noKey.status).toBe(400);
      expect(noKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

      const anonymous = await testApp
        .http()
        .post(POSTERS)
        .set('Idempotency-Key', randomUUID())
        .attach('file', poster, 'a.jpg');
      expect(anonymous.status).toBe(401);

      testApp.app
        .get(TestPrincipalResolvers)
        .set('staff', 8800, { kind: 'staff', id: 88, sessionId: 8800, role: 'box_office' });
      const boxOffice = testApp.app
        .get(AccessTokenService)
        .sign({ audience: 'staff', subjectId: 88, sessionId: 8800 });
      const forbidden = await testApp
        .http()
        .post(POSTERS)
        .set('Authorization', `Bearer ${boxOffice}`)
        .set('Idempotency-Key', randomUUID())
        .attach('file', poster, 'a.jpg');
      expect(forbidden.status).toBe(403);
      expect(forbidden.body.error.code).toBe('FORBIDDEN');

      expect(await imageRows()).toEqual([]);
      expect(await storedFiles(directory)).toEqual([]);
    });
  });

  describe('idempotency', () => {
    it('replays the same key and file: one row, one prefix, the same answer', async () => {
      const key = randomUUID();
      const first = await uploadPoster(poster, key);
      const second = await uploadPoster(poster, key);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.headers[REPLAYED]).toBe('true');
      expect(second.body).toEqual(first.body);
      expect(await imageRows()).toHaveLength(1);
      expect(await prefixesOnDisk()).toHaveLength(1);
    });

    it('two concurrent uploads with one key make one image; the other replays', async () => {
      const key = randomUUID();
      const responses = await Promise.all([uploadPoster(poster, key), uploadPoster(poster, key)]);

      expect(responses.map((response) => response.status)).toEqual([201, 201]);
      expect(responses.filter((response) => response.headers[REPLAYED] === 'true')).toHaveLength(1);
      expect(responses[0].body).toEqual(responses[1].body);
      expect(await imageRows()).toHaveLength(1);
      expect(await prefixesOnDisk()).toHaveLength(1);
    });

    it('refuses the same key with another file, and deletes that attempt’s files', async () => {
      const key = randomUUID();
      await uploadPoster(poster, key);
      const other = await uploadPoster(await jpeg(1000, 1500, '#aa3300'), key);

      expect(other.status).toBe(422);
      expect(other.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await imageRows()).toHaveLength(1);
      expect(await prefixesOnDisk()).toHaveLength(1);
    });
  });

  describe('a failed link', () => {
    it.each([
      ['breaks a foreign key', 'missing-owner', 500, 'INTERNAL'],
      ['throws an AppError', 'refuse', 404, 'NOT_FOUND'],
    ])(
      'that %s rolls the row back and deletes the uploaded files',
      async (_label, mode, status, code) => {
        const response = await testApp
          .http()
          .post(OWNERS)
          .set('Authorization', authorization)
          .set('Idempotency-Key', randomUUID())
          .field('mode', mode)
          .attach('file', await jpeg(800, 600), 'a.jpg');

        expect(response.status).toBe(status);
        expect(response.body.error.code).toBe(code);
        expect(await imageRows()).toEqual([]);
        expect(await testApp.knex(OWNERS_TABLE).count({ n: '*' })).toEqual([{ n: 0 }]);
        expect(await storedFiles(directory)).toEqual([]);
        // The key rolled back too, so a corrected retry with it runs again.
        expect(await testApp.knex('idempotency_keys').count({ n: '*' })).toEqual([{ n: 0 }]);
      },
    );
  });

  describe('deleting and replacing', () => {
    it('deletes the row in the request transaction and the files only after commit', async () => {
      const { body } = await uploadPoster(poster);
      expect(await storedFiles(directory)).toHaveLength(3);

      const response = await testApp
        .http()
        .delete(`/api/v1/test-media/images/${body.imageId}`)
        .set('Authorization', authorization);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ filesPresentBeforeCommit: true });
      expect(await imageRows()).toEqual([]);
      expect(await storedFiles(directory)).toEqual([]);
    });

    it('keeps the row and the files when the transaction rolls back', async () => {
      const { body } = await uploadPoster(poster);

      const response = await testApp
        .http()
        .delete(`/api/v1/test-media/images/${body.imageId}/failing`)
        .set('Authorization', authorization);

      expect(response.status).toBe(409);
      expect(await imageRows()).toHaveLength(1);
      expect(await storedFiles(directory)).toHaveLength(3);
    });

    it('replacing an owner’s image removes the old files after commit and keeps the new ones', async () => {
      const created = await testApp
        .http()
        .post(OWNERS)
        .set('Authorization', authorization)
        .set('Idempotency-Key', randomUUID())
        .attach('file', await jpeg(800, 600), 'a.jpg');
      const [oldPrefix] = await prefixesOnDisk();

      const replaced = await testApp
        .http()
        .put(`/api/v1/test-media/owners/${created.body.ownerId}/image`)
        .set('Authorization', authorization)
        .attach('file', await png(600, 600), 'face.png');

      expect(replaced.status).toBe(200);
      expect(replaced.body).toEqual({ ownerId: created.body.ownerId, imageId: 2 });
      const rows = await imageRows();
      expect(rows.map((row) => [row.id, row.kind])).toEqual([[2, 'person']]);
      expect(await prefixesOnDisk()).toEqual([rows[0]!.storage_prefix]);
      expect(rows[0]!.storage_prefix).not.toBe(oldPrefix);
      expect(await testApp.knex(OWNERS_TABLE).select('image_id')).toEqual([{ image_id: 2 }]);
    });
  });

  describe('/media serves files and nothing else', () => {
    it.each([
      ['PUT', (path: string) => testApp.http().put(path).send(Buffer.from('x'))],
      ['DELETE', (path: string) => testApp.http().delete(path)],
      ['POST', (path: string) => testApp.http().post(path).send({})],
    ])('a %s is not served: 404 NOT_FOUND, and the file stays', async (_method, send) => {
      const { body } = await uploadPoster(poster);
      const path = new URL(body.image.variants[0].url as string).pathname;

      const response = await send(path);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(await storedFiles(directory)).toHaveLength(3);
    });

    it.each([
      '/media/missing/small.webp',
      '/media/../package.json',
      '/media/%2e%2e/%2e%2e/package.json',
      '/media/',
    ])('GET %s is 404 NOT_FOUND', async (path) => {
      const response = await testApp.http().get(path);
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });
});
