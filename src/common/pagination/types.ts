/** The value a list is sorted by: a number, text (an ISO time, a name), or null. */
export type SortKey = string | number | null;

/** Where the next page starts: after the row with this sort key and id. */
export interface CursorPosition {
  readonly sortKey: SortKey;
  readonly id: number;
}

/** One page of a list (design §11): `{ items, nextCursor, total }`. */
export interface Page<T> {
  readonly items: readonly T[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  readonly nextCursor: string | null;
  /** How many items the whole list has, with the same filters. */
  readonly total: number;
}

/** A validated page request. */
export interface PageRequest {
  readonly after: CursorPosition | null;
  readonly limit: number;
}

/** The page part of a list query, as `PageQuery` validated it. */
export interface PageQueryInput {
  readonly cursor?: string;
  readonly limit?: number;
}
