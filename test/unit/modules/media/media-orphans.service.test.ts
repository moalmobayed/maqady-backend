import type { ImagesRepository } from '../../../../src/modules/media/images.repository';
import { MediaOrphansService } from '../../../../src/modules/media/media-orphans.service';
import type { StorageAdapter } from '../../../../src/modules/media/storage/storage.adapter';
import type { StorageListEntry } from '../../../../src/modules/media/types';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const OLD = new Date('2026-10-20T10:00:00.000Z');
const FRESH = new Date('2026-10-20T11:30:00.000Z');

const uuid = (digit: string): string => `${digit.repeat(8)}-1111-4111-8111-${digit.repeat(12)}`;
const files = (prefix: string, at: Date, bytes: number | null = 10): StorageListEntry[] =>
  ['small', 'medium', 'large'].map((name) => ({
    path: `${prefix}/${name}.webp`,
    updatedAt: at,
    bytes,
  }));

describe('MediaOrphansService', () => {
  const linked = `poster/${uuid('a')}`;
  const orphan = `gallery/${uuid('b')}`;
  const recent = `person/${uuid('c')}`;
  const unknown = ['notes.txt', 'poster/not-a-uuid/small.webp', `poster/${uuid('d')}`];

  let storage: jest.Mocked<Pick<StorageAdapter, 'list' | 'remove'>>;
  let images: jest.Mocked<Pick<ImagesRepository, 'existingPrefixes'>>;
  let service: MediaOrphansService;

  beforeEach(() => {
    storage = {
      list: jest.fn().mockResolvedValue([
        ...files(linked, OLD),
        ...files(orphan, OLD, null),
        // A prefix counts as recent by its newest file.
        { path: `${recent}/small.webp`, updatedAt: OLD, bytes: 5 },
        { path: `${recent}/large.webp`, updatedAt: FRESH, bytes: 7 },
        ...unknown.map((path) => ({ path, updatedAt: OLD, bytes: 1 })),
      ]),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    images = { existingPrefixes: jest.fn().mockResolvedValue(new Set([linked])) };
    service = new MediaOrphansService(
      storage as unknown as StorageAdapter,
      images as unknown as ImagesRepository,
      new TestClock(NOW),
    );
  });

  it('reports prefixes without a row, keeps recent ones apart, and lists unknown paths', async () => {
    const report = await service.scan();

    expect(storage.list).toHaveBeenCalledWith('');
    expect(images.existingPrefixes).toHaveBeenCalledWith([linked, orphan, recent]);
    expect(report.linkedPrefixes).toBe(1);
    expect(report.orphans).toEqual([
      {
        prefix: orphan,
        paths: files(orphan, OLD).map((entry) => entry.path),
        bytes: null,
        newestAt: OLD,
      },
    ]);
    expect(report.recent).toEqual([
      {
        prefix: recent,
        paths: [`${recent}/small.webp`, `${recent}/large.webp`],
        bytes: 12,
        newestAt: FRESH,
      },
    ]);
    expect(report.unknownPaths).toEqual(unknown);
  });

  it('looks prefixes up 500 at a time', async () => {
    const many = Array.from({ length: 1201 }, (_, index) => ({
      path: `gallery/${String(index).padStart(8, '0')}-1111-4111-8111-000000000000/small.webp`,
      updatedAt: OLD,
      bytes: 1,
    }));
    storage.list.mockResolvedValueOnce(many);
    images.existingPrefixes.mockResolvedValue(new Set());

    const report = await service.scan();

    expect(images.existingPrefixes.mock.calls.map(([batch]) => batch.length)).toEqual([
      500, 500, 201,
    ]);
    expect(report.orphans).toHaveLength(1201);
  });

  it('removes the files of the given orphans in one call', async () => {
    const { orphans } = await service.scan();
    expect(await service.remove(orphans)).toBe(3);
    expect(storage.remove).toHaveBeenCalledWith(files(orphan, OLD).map((entry) => entry.path));
  });

  it('makes no call when there is nothing to remove', async () => {
    expect(await service.remove([])).toBe(0);
    expect(storage.remove).not.toHaveBeenCalled();
  });
});
