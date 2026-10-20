import type { StorageListEntry, StorageObject } from '../types';

/**
 * Where image files live (design §9): Supabase Storage in every deployed environment, a local
 * directory in development and tests (`STORAGE_DRIVER`). It is its own injection token, like
 * `Clock`, so a test can replace it with `overrideProvider(StorageAdapter)`.
 *
 * Paths are `<kind>/<uuid>/<variant>.webp`: lower-case segments only, never `..`.
 */
export abstract class StorageAdapter {
  /** Stores one file. It never overwrites: an existing path is a bug, answered `INTERNAL`. */
  abstract put(object: StorageObject): Promise<void>;

  /** Deletes the files; a path that no longer exists is not an error, so retries are safe. */
  abstract remove(paths: readonly string[]): Promise<void>;

  /** Every file under `prefix` (`''` for everything), however deep. */
  abstract list(prefix: string): Promise<readonly StorageListEntry[]>;

  /** The public URL the browser loads the file from. Makes no request. */
  abstract publicUrl(path: string): string;
}
