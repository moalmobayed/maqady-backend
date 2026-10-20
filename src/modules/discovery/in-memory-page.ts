import { encodeCursor } from '../../common/pagination/cursor';
import type { Page, PageRequest } from '../../common/pagination/types';
import type { NamedItem } from './types';

const NAME_COLLATOR = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/**
 * Alphabetical by name ignoring case and accents, then by id: the order of the genres and of
 * the theaters on every discovery read, and what their cursors resume from.
 */
export function compareByNameThenId(a: NamedItem, b: NamedItem): number {
  return NAME_COLLATOR.compare(a.name, b.name) || a.id - b.id;
}

/**
 * One cursor page of a short list already held in memory and sorted by `compareByNameThenId`
 * (ten genres, the active theaters): the items after the cursor's `(name, id)`, with the same
 * `{ items, nextCursor, total }` and cursor codec as the database lists. The cursor resumes from
 * its position, not from an index, so an item added or removed between pages is never repeated
 * and never makes the next page skip one. The caller validates the cursor's kind (`text`).
 */
export function pageInMemory<T extends NamedItem>(
  sorted: readonly T[],
  request: PageRequest,
): Page<T> {
  const after = request.after;
  const rest =
    after === null
      ? sorted
      : sorted.filter(
          (item) =>
            compareByNameThenId(item, { id: after.id, name: String(after.sortKey ?? '') }) > 0,
        );
  const items = rest.slice(0, request.limit);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      rest.length > request.limit && last !== undefined
        ? encodeCursor({ sortKey: last.name, id: last.id })
        : null,
    total: sorted.length,
  };
}
