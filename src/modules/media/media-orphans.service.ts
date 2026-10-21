import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/time/clock';
import { subtractFromInstant } from '../../common/time/time';
import { ImagesRepository } from './images.repository';
import {
  ORPHAN_LOOKUP_BATCH,
  ORPHAN_MIN_AGE_MINUTES,
  STORAGE_PREFIX_PATTERN,
} from './media.constants';
import { StorageAdapter } from './storage/storage.adapter';
import type { OrphanPrefix, OrphanReport, StorageListEntry } from './types';

/**
 * Finds and removes stored files that no `images` row points to (design §9 "a maintenance script
 * lists and removes any orphaned storage paths"): left behind when a delete after commit, or the
 * clean-up of a failed upload, could not reach storage. It only tidies up; nothing depends on it.
 *
 * A prefix counts as orphaned when no row has it and its newest file is older than 60 minutes,
 * since an upload in flight stores its files before its row. Paths outside `<kind>/<uuid>/…`
 * are reported and never removed.
 */
@Injectable()
export class MediaOrphansService {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly images: ImagesRepository,
    private readonly clock: Clock,
  ) {}

  async scan(): Promise<OrphanReport> {
    const groups = new Map<string, StorageListEntry[]>();
    const unknownPaths: string[] = [];
    for (const entry of await this.storage.list('')) {
      const segments = entry.path.split('/');
      const prefix = segments.slice(0, 2).join('/');
      if (segments.length < 3 || !STORAGE_PREFIX_PATTERN.test(prefix)) {
        unknownPaths.push(entry.path);
        continue;
      }
      groups.set(prefix, [...(groups.get(prefix) ?? []), entry]);
    }

    const prefixes = [...groups.keys()];
    const linked = new Set<string>();
    for (let start = 0; start < prefixes.length; start += ORPHAN_LOOKUP_BATCH) {
      const batch = prefixes.slice(start, start + ORPHAN_LOOKUP_BATCH);
      for (const prefix of await this.images.existingPrefixes(batch)) linked.add(prefix);
    }

    const cutoff = subtractFromInstant(this.clock.now(), { minutes: ORPHAN_MIN_AGE_MINUTES });
    const orphans: OrphanPrefix[] = [];
    const recent: OrphanPrefix[] = [];
    for (const [prefix, entries] of groups) {
      if (linked.has(prefix)) continue;
      const orphan = orphanOf(prefix, entries);
      (orphan.newestAt < cutoff ? orphans : recent).push(orphan);
    }
    return { orphans, recent, unknownPaths, linkedPrefixes: linked.size };
  }

  /** Removes the files of these orphaned prefixes; returns how many files that was. */
  async remove(orphans: readonly OrphanPrefix[]): Promise<number> {
    const paths = orphans.flatMap((orphan) => orphan.paths);
    if (paths.length > 0) await this.storage.remove(paths);
    return paths.length;
  }
}

function orphanOf(prefix: string, entries: readonly StorageListEntry[]): OrphanPrefix {
  const sizes = entries.map((entry) => entry.bytes);
  return {
    prefix,
    paths: entries.map((entry) => entry.path),
    bytes: sizes.every((size) => size !== null)
      ? sizes.reduce<number>((sum, size) => sum + (size ?? 0), 0)
      : null,
    newestAt: new Date(Math.max(...entries.map((entry) => entry.updatedAt.getTime()))),
  };
}
