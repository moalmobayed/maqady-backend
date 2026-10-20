import type { INestApplicationContext } from '@nestjs/common';
import {
  parseOrphanArgs,
  runMediaOrphans,
} from '../../../../src/modules/media/media-orphans.command';
import { MediaOrphansService } from '../../../../src/modules/media/media-orphans.service';
import type { OrphanReport } from '../../../../src/modules/media/types';

const REPORT: OrphanReport = {
  orphans: [
    {
      prefix: 'gallery/b',
      paths: ['gallery/b/small.webp', 'gallery/b/large.webp'],
      bytes: 300,
      newestAt: new Date('2026-10-20T10:00:00.000Z'),
    },
  ],
  recent: [
    {
      prefix: 'person/c',
      paths: ['person/c/small.webp'],
      bytes: null,
      newestAt: new Date('2026-10-20T11:30:00.000Z'),
    },
  ],
  unknownPaths: ['notes.txt'],
  linkedPrefixes: 4,
};

function appWith(service: Pick<MediaOrphansService, 'scan' | 'remove'>): INestApplicationContext {
  return {
    get: (token: unknown) => {
      if (token !== MediaOrphansService) throw new Error('unexpected provider');
      return service;
    },
  } as unknown as INestApplicationContext;
}

describe('parseOrphanArgs', () => {
  it('lists by default and deletes only with --delete', () => {
    expect(parseOrphanArgs([])).toEqual({ delete: false });
    expect(parseOrphanArgs(['--delete'])).toEqual({ delete: true });
  });

  it('refuses any other argument', () => {
    expect(() => parseOrphanArgs(['--force'])).toThrow('Unknown argument --force');
  });
});

describe('runMediaOrphans', () => {
  it('prints one line per orphan, recent prefix and unknown path, and removes nothing', async () => {
    const service = { scan: jest.fn().mockResolvedValue(REPORT), remove: jest.fn() };
    const lines: string[] = [];

    await runMediaOrphans(appWith(service), [], (line) => lines.push(line));

    expect(lines).toEqual([
      'orphan gallery/b 2 300 2026-10-20T10:00:00.000Z',
      'recent person/c 1 ? 2026-10-20T11:30:00.000Z (kept: under 60 minutes old)',
      'unknown notes.txt (kept: not an image path)',
      '1 orphaned prefix(es), 1 recent, 1 unknown path(s), 4 linked.',
      'Run with --delete to remove the orphaned prefixes.',
    ]);
    expect(service.remove).not.toHaveBeenCalled();
  });

  it('with --delete, removes only the orphans and says how many files went', async () => {
    const service = {
      scan: jest.fn().mockResolvedValue(REPORT),
      remove: jest.fn().mockResolvedValue(2),
    };
    const lines: string[] = [];

    await runMediaOrphans(appWith(service), ['--delete'], (line) => lines.push(line));

    expect(service.remove).toHaveBeenCalledWith(REPORT.orphans);
    expect(lines.at(-1)).toBe('Removed 2 file(s) of 1 orphaned prefix(es).');
  });

  it('refuses an unknown argument before scanning', async () => {
    const service = { scan: jest.fn(), remove: jest.fn() };
    await expect(runMediaOrphans(appWith(service), ['--all'], () => undefined)).rejects.toThrow(
      'Unknown argument --all',
    );
    expect(service.scan).not.toHaveBeenCalled();
  });
});
