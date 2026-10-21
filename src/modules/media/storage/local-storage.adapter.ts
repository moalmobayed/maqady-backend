import { mkdir, readdir, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { AppError } from '../../../common/errors/app-error';
import type { LocalStorageConfig } from '../../../common/config/types';
import type { StorageListEntry, StorageObject } from '../types';
import { StorageAdapter } from './storage.adapter';
import { assertStoragePath, encodeStoragePath } from './storage-path';

/**
 * Files in a local directory, for development and tests (`STORAGE_DRIVER=local`). The app serves
 * the directory read-only under `/media` (`serveLocalMedia`). The directory is created on the
 * first write. Never use it on Render: the disk is wiped on every deploy.
 */
export class LocalStorageAdapter extends StorageAdapter {
  constructor(private readonly config: LocalStorageConfig) {
    super();
  }

  async put(object: StorageObject): Promise<void> {
    const file = this.fileOf(object.path);
    try {
      await mkdir(dirname(file), { recursive: true });
      // `wx`: fail rather than overwrite; paths are unique per image.
      await writeFile(file, object.body, { flag: 'wx' });
    } catch (error) {
      throw new AppError('INTERNAL', 'An image file could not be written.', null, {
        cause: error,
      });
    }
  }

  async remove(paths: readonly string[]): Promise<void> {
    const files = paths.map((path) => this.fileOf(path));
    try {
      for (const file of files) await rm(file, { force: true });
      // Tidy the emptied prefix folders, deepest first, but never the root directory itself.
      const folders = [...new Set(files.map((file) => dirname(file)))].sort().reverse();
      for (const folder of folders) await this.removeEmptyFolders(folder);
    } catch (error) {
      throw new AppError('INTERNAL', 'An image file could not be deleted.', null, {
        cause: error,
      });
    }
  }

  async list(prefix: string): Promise<readonly StorageListEntry[]> {
    assertStoragePath(prefix, { allowEmpty: true });
    const start = prefix === '' ? this.root() : this.fileOf(prefix);
    const entries: StorageListEntry[] = [];
    try {
      await this.walk(start, entries);
    } catch (error) {
      throw new AppError('INTERNAL', 'The image directory could not be listed.', null, {
        cause: error,
      });
    }
    return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  publicUrl(path: string): string {
    assertStoragePath(path);
    return `${this.config.publicBaseUrl}/${encodeStoragePath(path)}`;
  }

  private root(): string {
    return resolve(this.config.directory);
  }

  /** The file of a storage path, refusing anything that would resolve outside the directory. */
  private fileOf(path: string): string {
    assertStoragePath(path);
    const root = this.root();
    const file = resolve(root, ...path.split('/'));
    const inside = relative(root, file);
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
      throw new AppError('INTERNAL', 'An image storage path is malformed.');
    }
    return file;
  }

  private async walk(folder: string, entries: StorageListEntry[]): Promise<void> {
    let names: string[];
    try {
      names = await readdir(folder);
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    for (const name of names.sort()) {
      const file = join(folder, name);
      const info = await stat(file);
      if (info.isDirectory()) {
        await this.walk(file, entries);
      } else if (info.isFile()) {
        entries.push({
          path: relative(this.root(), file).split(sep).join('/'),
          updatedAt: info.mtime,
          bytes: info.size,
        });
      }
    }
  }

  /** Removes `folder` and its parents while they are empty, stopping at the root directory. */
  private async removeEmptyFolders(folder: string): Promise<void> {
    const root = this.root();
    for (let current = folder; current.startsWith(root + sep); current = dirname(current)) {
      try {
        await rmdir(current);
      } catch (error) {
        if (isMissing(error)) continue;
        const { code } = error as { code?: unknown };
        if (code === 'ENOTEMPTY' || code === 'EEXIST') return;
        throw error;
      }
    }
  }
}

function isMissing(error: unknown): boolean {
  return (error as { code?: unknown }).code === 'ENOENT';
}
