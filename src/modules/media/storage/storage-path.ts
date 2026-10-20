import { AppError } from '../../../common/errors/app-error';
import { STORAGE_SEGMENT_PATTERN } from '../media.constants';

/**
 * Refuses any path that is not lower-case segments separated by `/` (no `..`, no leading `/`, no
 * empty segment), so a path can neither escape the bucket or directory nor need escaping. Paths
 * are built by this module, so a bad one is a bug: `INTERNAL`.
 */
export function assertStoragePath(path: string, { allowEmpty = false } = {}): void {
  if (allowEmpty && path === '') return;
  const valid = path.split('/').every((segment) => STORAGE_SEGMENT_PATTERN.test(segment));
  if (!valid) throw new AppError('INTERNAL', 'An image storage path is malformed.');
}

/** The path with each segment URI-encoded, for a URL. */
export function encodeStoragePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
