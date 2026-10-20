import { AppError } from '../../../../src/common/errors/app-error';
import {
  decodeCursor,
  encodeCursor,
  toPage,
  toPageRequest,
} from '../../../../src/common/pagination/cursor';
import { PageResponseOf } from '../../../../src/common/pagination/dto/page-response.dto';

function validationField(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError && error.code === 'VALIDATION_FAILED') {
      return (error.details as { fields: { field: string }[] }).fields[0]?.field;
    }
    throw error;
  }
  return undefined;
}

describe('cursor', () => {
  it.each([
    { sortKey: '2026-10-16T19:30:00+03:00', id: 42 },
    { sortKey: 1500, id: 1 },
    { sortKey: null, id: 9007199254740991 },
    { sortKey: 'Café — ممر', id: 3 },
  ])('round-trips %p as opaque base64url', (position) => {
    const cursor = encodeCursor(position);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toEqual(position);
  });

  it.each([
    ['empty', ''],
    ['not base64url', 'abc$'],
    ['not JSON', Buffer.from('nope').toString('base64url')],
    ['not a pair', Buffer.from('[1]').toString('base64url')],
    ['an object', Buffer.from('{"id":1}').toString('base64url')],
    ['a non-integer id', Buffer.from('["a",1.5]').toString('base64url')],
    ['a zero id', Buffer.from('["a",0]').toString('base64url')],
    ['an object sort key', Buffer.from('[{"a":1},1]').toString('base64url')],
    ['too long', 'a'.repeat(513)],
  ])('refuses a cursor that is %s, as VALIDATION_FAILED on cursor', (_case, cursor) => {
    expect(validationField(() => decodeCursor(cursor))).toBe('cursor');
  });
});

describe('toPageRequest', () => {
  it('defaults to 20 items from the start', () => {
    expect(toPageRequest({})).toEqual({ after: null, limit: 20 });
  });

  it('decodes the cursor and keeps a limit up to 100', () => {
    const cursor = encodeCursor({ sortKey: 'x', id: 5 });
    expect(toPageRequest({ cursor, limit: 100 })).toEqual({
      after: { sortKey: 'x', id: 5 },
      limit: 100,
    });
  });

  it('refuses a limit outside 1 to 100', () => {
    expect(validationField(() => toPageRequest({ limit: 0 }))).toBe('limit');
    expect(validationField(() => toPageRequest({ limit: 101 }))).toBe('limit');
  });
});

describe('toPage', () => {
  const rows = [
    { id: 1, title: 'a' },
    { id: 2, title: 'b' },
    { id: 3, title: 'c' },
  ];
  const positionOf = (row: { id: number; title: string }) => ({ sortKey: row.title, id: row.id });
  const toItem = (row: { id: number; title: string }) => ({ name: row.title });

  it('returns limit items and a cursor after the last one when an extra row came back', () => {
    const page = toPage(rows, { after: null, limit: 2 }, 7, positionOf, toItem);
    expect(page.items).toEqual([{ name: 'a' }, { name: 'b' }]);
    expect(page.total).toBe(7);
    expect(decodeCursor(page.nextCursor!)).toEqual({ sortKey: 'b', id: 2 });
  });

  it('has no next cursor on the last page', () => {
    expect(toPage(rows, { after: null, limit: 3 }, 3, positionOf, toItem).nextCursor).toBeNull();
    expect(toPage([], { after: null, limit: 20 }, 0, positionOf, toItem)).toEqual({
      items: [],
      nextCursor: null,
      total: 0,
    });
  });
});

describe('PageResponseOf', () => {
  class BookingSummary {}

  it('names the page class after its item, once per item class', () => {
    const page = PageResponseOf(BookingSummary);
    expect(page.name).toBe('BookingSummaryPage');
    expect(PageResponseOf(BookingSummary)).toBe(page);
  });
});
