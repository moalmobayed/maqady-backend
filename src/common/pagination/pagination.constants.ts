/** Lists return 20 items unless asked otherwise, and never more than 100 (design §11). */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** A cursor is short; anything longer is refused before decoding. */
export const MAX_CURSOR_LENGTH = 512;

export const INVALID_CURSOR_MESSAGE = 'cursor is not valid; pass nextCursor from the previous page';
