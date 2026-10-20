import { Logger } from '@nestjs/common';
import type { StaffPrincipal } from '../../../../src/common/auth/types';
import type { TransactionContext } from '../../../../src/common/database/transaction-context';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import type { PostCommitHook } from '../../../../src/common/database/types';
import { AppError } from '../../../../src/common/errors/app-error';
import type { IdempotencyService } from '../../../../src/common/idempotency/idempotency.service';
import type { ImagePipeline } from '../../../../src/modules/media/image-pipeline';
import type { ImagesRepository } from '../../../../src/modules/media/images.repository';
import { MediaService } from '../../../../src/modules/media/media.service';
import type { StorageAdapter } from '../../../../src/modules/media/storage/storage.adapter';
import type {
  ImageRow,
  ImageUploadPayload,
  NewImageRow,
  ProcessedImage,
  StoredImage,
  StoredImageVariants,
} from '../../../../src/modules/media/types';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-20T10:00:00.000Z');
const ADMIN: StaffPrincipal = { kind: 'staff', id: 7, sessionId: 70, role: 'admin' };
const PREFIX_PATTERN = /^poster\/[0-9a-f-]{36}$/;

const PROCESSED: ProcessedImage = {
  kind: 'poster',
  sourceWidth: 1000,
  sourceHeight: 1500,
  variants: [
    { name: 'small', data: Buffer.from('s'), width: 200, height: 300 },
    { name: 'medium', data: Buffer.from('mm'), width: 400, height: 600 },
    { name: 'large', data: Buffer.from('lll'), width: 800, height: 1200 },
  ],
};

const UPLOAD: ImageUploadPayload = {
  buffer: Buffer.from('jpeg bytes'),
  byteSize: 10,
  fileSha256: 'a'.repeat(64),
  successStatus: 201,
};

const KEYED_UPLOAD: ImageUploadPayload = {
  ...UPLOAD,
  idempotency: { scope: 'staff:7', key: 'key-1', requestHash: 'hash-1' },
};

function deadlock(): Error {
  return Object.assign(new Error('deadlock detected'), { code: '40P01', severity: 'ERROR' });
}

/** Runs `fn` as a transaction: post-commit hooks run only when it resolves. */
class FakeTransactions {
  runs = 0;
  private hooks: PostCommitHook[] | undefined;

  async run<T>(fn: () => Promise<T>): Promise<T> {
    this.runs += 1;
    const hooks: PostCommitHook[] = [];
    this.hooks = hooks;
    let result: T;
    try {
      result = await fn();
    } finally {
      this.hooks = undefined;
    }
    for (const hook of hooks) await hook();
    return result;
  }

  async afterCommit(hook: PostCommitHook): Promise<void> {
    if (this.hooks) this.hooks.push(hook);
    else await hook();
  }
}

function rowFor(row: NewImageRow, id = 41): ImageRow {
  return { id, ...row };
}

describe('MediaService', () => {
  let pipeline: jest.Mocked<Pick<ImagePipeline, 'process'>>;
  let storage: jest.Mocked<StorageAdapter>;
  let images: jest.Mocked<Pick<ImagesRepository, 'insert' | 'findByIds' | 'deleteByIds'>>;
  let idempotency: jest.Mocked<Pick<IdempotencyService, 'claim' | 'complete'>>;
  let context: { isActive: jest.Mock<boolean, []> };
  let transactions: FakeTransactions;
  let service: MediaService;
  let calls: string[];

  beforeEach(() => {
    calls = [];
    pipeline = { process: jest.fn().mockResolvedValue(PROCESSED) };
    storage = {
      put: jest.fn().mockImplementation(({ path }: { path: string }) => {
        calls.push(`put ${path.split('/')[2]}`);
        return Promise.resolve();
      }),
      remove: jest.fn().mockResolvedValue(undefined),
      list: jest.fn(),
      publicUrl: jest.fn((path: string) => `https://cdn.example/${path}`),
    };
    images = {
      insert: jest.fn().mockImplementation((row: NewImageRow) => {
        calls.push('insert');
        return Promise.resolve(rowFor(row));
      }),
      findByIds: jest.fn(),
      deleteByIds: jest.fn(),
    };
    idempotency = {
      claim: jest.fn().mockImplementation(() => {
        calls.push('claim');
        return Promise.resolve({ kind: 'claimed', id: 99 });
      }),
      complete: jest.fn().mockImplementation(() => {
        calls.push('complete');
        return Promise.resolve();
      }),
    };
    context = { isActive: jest.fn(() => false) };
    transactions = new FakeTransactions();
    service = new MediaService(
      pipeline as unknown as ImagePipeline,
      storage,
      images as unknown as ImagesRepository,
      transactions as unknown as TransactionRepository,
      context as unknown as TransactionContext,
      idempotency as unknown as IdempotencyService,
      new TestClock(NOW),
    );
  });

  const uploadedPaths = (): string[] => storage.put.mock.calls.map(([object]) => object.path);

  describe('upload', () => {
    it('processes, stores three variants under one new prefix, then inserts and links the row', async () => {
      const link = jest.fn((image: StoredImage) => {
        calls.push('link');
        return Promise.resolve({ photoId: 5, imageId: image.id });
      });

      const outcome = await service.upload({ kind: 'poster', upload: UPLOAD, actor: ADMIN, link });

      expect(pipeline.process).toHaveBeenCalledWith(UPLOAD.buffer, 'poster');
      const paths = uploadedPaths();
      const prefix = paths[0]!.split('/').slice(0, 2).join('/');
      expect(prefix).toMatch(PREFIX_PATTERN);
      expect(paths).toEqual([
        `${prefix}/small.webp`,
        `${prefix}/medium.webp`,
        `${prefix}/large.webp`,
      ]);
      expect(storage.put).toHaveBeenCalledWith({
        path: `${prefix}/medium.webp`,
        body: PROCESSED.variants[1]!.data,
        contentType: 'image/webp',
      });
      const variants: StoredImageVariants = {
        small: { path: `${prefix}/small.webp`, width: 200, height: 300, bytes: 1 },
        medium: { path: `${prefix}/medium.webp`, width: 400, height: 600, bytes: 2 },
        large: { path: `${prefix}/large.webp`, width: 800, height: 1200, bytes: 3 },
      };
      expect(images.insert).toHaveBeenCalledWith({
        kind: 'poster',
        storage_prefix: prefix,
        variants,
        source_width: 1000,
        source_height: 1500,
        created_by_staff_id: 7,
        created_at: NOW,
      });
      expect(link).toHaveBeenCalledWith({
        id: 41,
        kind: 'poster',
        storagePrefix: prefix,
        variants,
        sourceWidth: 1000,
        sourceHeight: 1500,
        createdByStaffId: 7,
        createdAt: NOW,
      });
      expect(calls).toEqual([
        'put small.webp',
        'put medium.webp',
        'put large.webp',
        'insert',
        'link',
      ]);
      expect(outcome).toEqual({ status: 201, body: { photoId: 5, imageId: 41 }, replayed: false });
      expect(idempotency.claim).not.toHaveBeenCalled();
      expect(storage.remove).not.toHaveBeenCalled();
      expect(transactions.runs).toBe(1);
    });

    it('claims the key first in the transaction and stores the response under it before commit', async () => {
      const outcome = await service.upload({
        kind: 'poster',
        upload: KEYED_UPLOAD,
        actor: ADMIN,
        link: () => Promise.resolve({ ok: true }),
      });

      expect(calls.slice(3)).toEqual(['claim', 'insert', 'complete']);
      expect(idempotency.claim).toHaveBeenCalledWith(KEYED_UPLOAD.idempotency);
      expect(idempotency.complete).toHaveBeenCalledWith(99, KEYED_UPLOAD.idempotency, 201, {
        ok: true,
      });
      expect(outcome.replayed).toBe(false);
    });

    it('on a replay, answers the stored response and deletes the files this attempt stored', async () => {
      idempotency.claim.mockResolvedValueOnce({
        kind: 'replay',
        status: 201,
        body: { photoId: 3 },
      });
      const link = jest.fn();

      const outcome = await service.upload({
        kind: 'poster',
        upload: KEYED_UPLOAD,
        actor: ADMIN,
        link,
      });

      expect(outcome).toEqual({ status: 201, body: { photoId: 3 }, replayed: true });
      expect(images.insert).not.toHaveBeenCalled();
      expect(link).not.toHaveBeenCalled();
      expect(storage.remove).toHaveBeenCalledWith(uploadedPaths());
    });

    it('when the row insert fails, deletes every uploaded file and rethrows the original error', async () => {
      const failure = new Error('insert failed');
      images.insert.mockRejectedValueOnce(failure);

      await expect(
        service.upload({ kind: 'poster', upload: UPLOAD, actor: ADMIN, link: jest.fn() }),
      ).rejects.toBe(failure);

      expect(uploadedPaths()).toHaveLength(3);
      expect(storage.remove).toHaveBeenCalledTimes(1);
      expect(storage.remove).toHaveBeenCalledWith(uploadedPaths());
    });

    it('still rethrows the original error when deleting the files fails too, and logs the paths', async () => {
      const failure = new AppError('NOT_FOUND');
      storage.remove.mockRejectedValueOnce(new AppError('STORAGE_UNAVAILABLE'));
      const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(
        service.upload({
          kind: 'poster',
          upload: UPLOAD,
          actor: ADMIN,
          link: () => Promise.reject(failure),
        }),
      ).rejects.toBe(failure);

      expect(logged).toHaveBeenCalledWith(
        expect.objectContaining({ paths: uploadedPaths(), err: expect.any(AppError) }),
        expect.stringContaining('media:orphans'),
      );
    });

    it('when the key was reused for another file, deletes this attempt’s files', async () => {
      idempotency.claim.mockRejectedValueOnce(new AppError('IDEMPOTENCY_KEY_REUSED'));

      await expect(
        service.upload({ kind: 'poster', upload: KEYED_UPLOAD, actor: ADMIN, link: jest.fn() }),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
      expect(storage.remove).toHaveBeenCalledWith(uploadedPaths());
    });

    it('retries the transaction once on a deadlock, reusing the stored files', async () => {
      images.insert.mockRejectedValueOnce(deadlock());

      const outcome = await service.upload({
        kind: 'poster',
        upload: UPLOAD,
        actor: ADMIN,
        link: () => Promise.resolve('linked'),
      });

      expect(outcome.body).toBe('linked');
      expect(transactions.runs).toBe(2);
      expect(storage.put).toHaveBeenCalledTimes(3);
      expect(pipeline.process).toHaveBeenCalledTimes(1);
      expect(storage.remove).not.toHaveBeenCalled();
    });

    it('gives up after a second deadlock and deletes the files', async () => {
      const second = deadlock();
      images.insert.mockRejectedValueOnce(deadlock()).mockRejectedValueOnce(second);

      await expect(
        service.upload({ kind: 'poster', upload: UPLOAD, actor: ADMIN, link: jest.fn() }),
      ).rejects.toBe(second);
      expect(transactions.runs).toBe(2);
      expect(storage.remove).toHaveBeenCalledWith(uploadedPaths());
    });

    it('when storing a variant fails, removes the variants of the prefix and writes no row', async () => {
      storage.put
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new AppError('STORAGE_UNAVAILABLE'));

      await expect(
        service.upload({ kind: 'poster', upload: UPLOAD, actor: ADMIN, link: jest.fn() }),
      ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });

      const prefix = uploadedPaths()[0]!.split('/').slice(0, 2).join('/');
      expect(storage.remove).toHaveBeenCalledWith([
        `${prefix}/small.webp`,
        `${prefix}/medium.webp`,
        `${prefix}/large.webp`,
      ]);
      expect(images.insert).not.toHaveBeenCalled();
      expect(transactions.runs).toBe(0);
    });

    it('stores nothing when the pipeline refuses the file', async () => {
      pipeline.process.mockRejectedValueOnce(new AppError('UNSUPPORTED_IMAGE_TYPE'));
      await expect(
        service.upload({ kind: 'poster', upload: UPLOAD, actor: ADMIN, link: jest.fn() }),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE_TYPE' });
      expect(storage.put).not.toHaveBeenCalled();
      expect(transactions.runs).toBe(0);
    });

    it('refuses to run inside an open transaction, before any image work', async () => {
      context.isActive.mockReturnValue(true);
      await expect(
        service.upload({ kind: 'poster', upload: UPLOAD, actor: ADMIN, link: jest.fn() }),
      ).rejects.toMatchObject({ code: 'INTERNAL' });
      expect(pipeline.process).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    const stored = (id: number, prefix: string): ImageRow => ({
      id,
      kind: 'gallery',
      storage_prefix: prefix,
      variants: {
        small: { path: `${prefix}/small.webp`, width: 1, height: 1, bytes: 1 },
        medium: { path: `${prefix}/medium.webp`, width: 1, height: 1, bytes: 1 },
        large: { path: `${prefix}/large.webp`, width: 1, height: 1, bytes: 1 },
      },
      source_width: 1,
      source_height: 1,
      created_by_staff_id: 7,
      created_at: NOW,
    });

    it('deletes the rows at once and their files only after the transaction commits', async () => {
      images.deleteByIds.mockResolvedValueOnce([stored(1, 'gallery/a'), stored(2, 'gallery/b')]);
      let removedBeforeCommit: boolean | undefined;

      await transactions.run(async () => {
        await service.deleteMany([1, 2, 1]);
        removedBeforeCommit = storage.remove.mock.calls.length > 0;
      });

      expect(images.deleteByIds).toHaveBeenCalledWith([1, 2]);
      expect(removedBeforeCommit).toBe(false);
      expect(storage.remove).toHaveBeenCalledTimes(1);
      expect(storage.remove).toHaveBeenCalledWith([
        'gallery/a/small.webp',
        'gallery/a/medium.webp',
        'gallery/a/large.webp',
        'gallery/b/small.webp',
        'gallery/b/medium.webp',
        'gallery/b/large.webp',
      ]);
    });

    it('keeps the files when the transaction rolls back', async () => {
      images.deleteByIds.mockResolvedValueOnce([stored(1, 'gallery/a')]);
      await expect(
        transactions.run(async () => {
          await service.delete(1);
          throw new AppError('CONFLICT');
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(storage.remove).not.toHaveBeenCalled();
    });

    it('logs instead of failing when the files cannot be deleted after commit', async () => {
      images.deleteByIds.mockResolvedValueOnce([stored(1, 'gallery/a')]);
      storage.remove.mockRejectedValueOnce(new AppError('STORAGE_UNAVAILABLE'));
      const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await transactions.run(() => service.delete(1));

      expect(logged).toHaveBeenCalledTimes(1);
    });

    it('schedules nothing when no row was deleted', async () => {
      images.deleteByIds.mockResolvedValueOnce([]);
      await service.delete(404);
      expect(storage.remove).not.toHaveBeenCalled();
    });
  });

  describe('reading', () => {
    const image: StoredImage = {
      id: 3,
      kind: 'poster',
      storagePrefix: 'poster/p',
      variants: {
        large: { path: 'poster/p/large.webp', width: 800, height: 1200, bytes: 3 },
        small: { path: 'poster/p/small.webp', width: 200, height: 300, bytes: 1 },
        medium: { path: 'poster/p/medium.webp', width: 400, height: 600, bytes: 2 },
      },
      sourceWidth: 1000,
      sourceHeight: 1500,
      createdByStaffId: 7,
      createdAt: NOW,
    };

    it('builds the Image of a response, smallest first, with public URLs', () => {
      expect(service.toImageResponse(image, 'The Last Lighthouse poster')).toEqual({
        alt: 'The Last Lighthouse poster',
        variants: [
          {
            name: 'small',
            url: 'https://cdn.example/poster/p/small.webp',
            width: 200,
            height: 300,
          },
          {
            name: 'medium',
            url: 'https://cdn.example/poster/p/medium.webp',
            width: 400,
            height: 600,
          },
          {
            name: 'large',
            url: 'https://cdn.example/poster/p/large.webp',
            width: 800,
            height: 1200,
          },
        ],
      });
      expect(service.toImageResponse(image, null)?.alt).toBeNull();
    });

    it('answers null when there is no image', () => {
      expect(service.toImageResponse(undefined, 'anything')).toBeNull();
    });

    it('reads several images in one query, by id', async () => {
      images.findByIds.mockResolvedValueOnce([
        {
          id: 3,
          kind: 'poster',
          storage_prefix: 'poster/p',
          variants: image.variants,
          source_width: 1000,
          source_height: 1500,
          created_by_staff_id: 7,
          created_at: NOW,
        },
      ]);

      const found = await service.findByIds([3, 4, 3]);

      expect(images.findByIds).toHaveBeenCalledTimes(1);
      expect(images.findByIds).toHaveBeenCalledWith([3, 4]);
      expect(found.get(3)).toEqual(image);
      expect(found.has(4)).toBe(false);
    });
  });
});
