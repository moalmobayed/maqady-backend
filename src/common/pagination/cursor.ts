import { AppError } from '../errors/app-error';
import {
  DEFAULT_PAGE_SIZE,
  INVALID_CURSOR_MESSAGE,
  MAX_CURSOR_LENGTH,
  MAX_PAGE_SIZE,
} from './pagination.constants';
import type { CursorPosition, Page, PageQueryInput, PageRequest, SortKey } from './types';

/**
 * Cursor pagination (design §11). A cursor is the opaque base64url encoding of the last row's
 * sort key and id, so a page is "rows after (sortKey, id)" in the list's order, and it stays
 * stable while rows are added. Clients never build or read a cursor.
 */

export function encodeCursor(position: CursorPosition): string {
  return Buffer.from(JSON.stringify([position.sortKey, position.id]), 'utf8').toString('base64url');
}

/** The position a cursor encodes; `VALIDATION_FAILED` on `cursor` when it was tampered with. */
export function decodeCursor(cursor: string): CursorPosition {
  if (
    cursor.length === 0 ||
    cursor.length > MAX_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(cursor)
  ) {
    throw invalidCursor();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) throw invalidCursor();
  const [sortKey, id] = parsed as [unknown, unknown];
  if (!isSortKey(sortKey) || typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) {
    throw invalidCursor();
  }
  return { sortKey, id };
}

/** The page request for a list query: the decoded cursor and the page size (default 20). */
export function toPageRequest(query: PageQueryInput): PageRequest {
  const limit = query.limit ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new AppError('VALIDATION_FAILED', undefined, {
      fields: [
        { field: 'limit', messages: [`limit must be an integer from 1 to ${MAX_PAGE_SIZE}`] },
      ],
    });
  }
  return { after: query.cursor === undefined ? null : decodeCursor(query.cursor), limit };
}

/**
 * Builds a page from up to `limit + 1` rows fetched in list order: the extra row only tells that
 * another page exists. `positionOf` gives a row's sort key and id for the cursor.
 */
export function toPage<Row, Item>(
  rows: readonly Row[],
  request: PageRequest,
  total: number,
  positionOf: (row: Row) => CursorPosition,
  toItem: (row: Row) => Item,
): Page<Item> {
  const pageRows = rows.slice(0, request.limit);
  const last = pageRows[pageRows.length - 1];
  const hasMore = rows.length > request.limit && last !== undefined;
  return {
    items: pageRows.map(toItem),
    nextCursor: hasMore ? encodeCursor(positionOf(last)) : null,
    total,
  };
}

function isSortKey(value: unknown): value is SortKey {
  return (
    value === null ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function invalidCursor(): AppError {
  return new AppError('VALIDATION_FAILED', undefined, {
    fields: [{ field: 'cursor', messages: [INVALID_CURSOR_MESSAGE] }],
  });
}
