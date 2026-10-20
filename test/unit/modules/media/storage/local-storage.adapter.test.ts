import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError } from '../../../../../src/common/errors/app-error';
import { LocalStorageAdapter } from '../../../../../src/modules/media/storage/local-storage.adapter';

const PREFIX = 'poster/0f1e2d3c-4b5a-4968-8776-655443322110';

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected a storage error');
}

describe('LocalStorageAdapter', () => {
  let directory: string;
  let adapter: LocalStorageAdapter;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'maqady-local-storage-'));
    // The directory itself is created on the first write.
    adapter = new LocalStorageAdapter({
      driver: 'local',
      directory: join(directory, 'media'),
      publicBaseUrl: 'http://localhost:3105/media',
    });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('stores, lists and removes files, tidying the emptied folders', async () => {
    await adapter.put({
      path: `${PREFIX}/small.webp`,
      body: Buffer.from('s'),
      contentType: 'image/webp',
    });
    await adapter.put({
      path: `${PREFIX}/large.webp`,
      body: Buffer.from('large'),
      contentType: 'image/webp',
    });

    expect(await readFile(join(directory, 'media', PREFIX, 'small.webp'), 'utf8')).toBe('s');
    const entries = await adapter.list('');
    expect(entries.map(({ path, bytes }) => [path, bytes])).toEqual([
      [`${PREFIX}/large.webp`, 5],
      [`${PREFIX}/small.webp`, 1],
    ]);
    expect(Math.abs(entries[0]!.updatedAt.getTime() - Date.now())).toBeLessThan(60_000);
    expect(await adapter.list('poster')).toHaveLength(2);
    expect(await adapter.list('gallery')).toEqual([]);

    await adapter.remove([`${PREFIX}/small.webp`, `${PREFIX}/large.webp`]);

    expect(await adapter.list('')).toEqual([]);
    // The prefix and kind folders went with their last file; the root stays.
    expect(await readdir(join(directory, 'media'))).toEqual([]);
  });

  it('never overwrites a file', async () => {
    const object = {
      path: `${PREFIX}/small.webp`,
      body: Buffer.from('first'),
      contentType: 'image/webp' as const,
    };
    await adapter.put(object);
    const error = await failure(adapter.put({ ...object, body: Buffer.from('second') }));
    expect(error.code).toBe('INTERNAL');
    expect(await readFile(join(directory, 'media', PREFIX, 'small.webp'), 'utf8')).toBe('first');
  });

  it('removes a missing path without complaint, and keeps a folder that still has files', async () => {
    await adapter.put({
      path: `${PREFIX}/small.webp`,
      body: Buffer.from('s'),
      contentType: 'image/webp',
    });
    await adapter.remove([`${PREFIX}/medium.webp`, 'gallery/nothing/here.webp']);
    expect((await adapter.list('')).map((entry) => entry.path)).toEqual([`${PREFIX}/small.webp`]);
  });

  it.each(['../outside.webp', 'poster/../../outside.webp', '/etc/passwd', 'poster//x.webp', ''])(
    'refuses the path %j, which could leave the directory',
    async (path) => {
      const error = await failure(
        adapter.put({ path, body: Buffer.from('x'), contentType: 'image/webp' }),
      );
      expect(error.code).toBe('INTERNAL');
      expect((await failure(adapter.remove([path]))).code).toBe('INTERNAL');
    },
  );

  it('does not follow ../ when listing', async () => {
    await writeFile(join(directory, 'secret.txt'), 'outside');
    expect((await failure(adapter.list('..'))).code).toBe('INTERNAL');
  });

  it('builds public URLs under the configured base', () => {
    expect(adapter.publicUrl(`${PREFIX}/small.webp`)).toBe(
      `http://localhost:3105/media/${PREFIX}/small.webp`,
    );
  });
});
