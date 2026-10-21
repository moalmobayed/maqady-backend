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

  it('refuses a text sort key holding a NUL character, which Postgres text cannot store', () => {
    const cursor = encodeCursor({ sortKey: 'a\u0000b', id: 1 });
    expect(validationField(() => decodeCursor(cursor))).toBe('cursor');
    expect(validationField(() => decodeCursor(cursor, 'text'))).toBe('cursor');
  });

  describe("checked against the list's sort-key kind", () => {
    const cursorWith = (sortKey: string | number | null): string =>
      encodeCursor({ sortKey, id: 7 });

    it.each([
      ['instant', '2026-10-16T19:30:00+03:00'],
      ['instant', '2026-10-16T16:30:00.123Z'],
      ['text', 'Café — ممر'],
      ['number', 1500],
      ['number', -2.5],
      ['instant', null],
      ['text', null],
      ['number', null],
    ] as const)('accepts a %s sort key %p', (kind, sortKey) => {
      expect(decodeCursor(cursorWith(sortKey), kind)).toEqual({ sortKey, id: 7 });
    });

    it.each([
      ['instant', 'not-a-time'],
      ['instant', '2026-10-16'],
      ['instant', '2026-W42-5'],
      ['instant', '2026-02-30T10:00:00Z'],
      ['instant', '2026-10-16T19:30:00'],
      ['instant', 42],
      ['text', 42],
      ['number', '42'],
    ] as const)(
      'refuses a %s sort key %p as VALIDATION_FAILED, not a database error',
      (kind, sortKey) => {
        expect(validationField(() => decodeCursor(cursorWith(sortKey), kind))).toBe('cursor');
      },
    );

    it('is checked by toPageRequest too', () => {
      const query = { cursor: cursorWith('not-a-time') };
      expect(validationField(() => toPageRequest(query, 'instant'))).toBe('cursor');
      expect(toPageRequest({ cursor: cursorWith(1500) }, 'number').after).toEqual({
        sortKey: 1500,
        id: 7,
      });
    });
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
