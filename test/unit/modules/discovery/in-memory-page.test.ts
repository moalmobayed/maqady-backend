import {
  decodeCursor,
  encodeCursor,
  toPageRequest,
} from '../../../../src/common/pagination/cursor';
import { AppError } from '../../../../src/common/errors/app-error';
import {
  compareByNameThenId,
  pageInMemory,
} from '../../../../src/modules/discovery/in-memory-page';

const ITEMS = [
  { id: 4, name: 'Action' },
  { id: 2, name: 'adventure' },
  { id: 9, name: 'Comedy' },
  { id: 3, name: 'Drama' },
  { id: 7, name: 'Mystery' },
];

describe('compareByNameThenId', () => {
  it('orders by name ignoring case, then by id', () => {
    const shuffled = [
      { id: 2, name: 'b' },
      { id: 5, name: 'B' },
      { id: 1, name: 'a' },
      { id: 3, name: 'C' },
    ];
    expect([...shuffled].sort(compareByNameThenId)).toEqual([
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
      { id: 5, name: 'B' },
      { id: 3, name: 'C' },
    ]);
  });
});

describe('pageInMemory', () => {
  it('returns everything and no cursor when it fits in one page', () => {
    const page = pageInMemory(ITEMS, { after: null, limit: 20 });
    expect(page).toEqual({ items: ITEMS, nextCursor: null, total: 5 });
  });

  it('returns exactly a page when one more item exists, with the cursor of its last item', () => {
    const page = pageInMemory(ITEMS, { after: null, limit: 2 });
    expect(page.items).toEqual(ITEMS.slice(0, 2));
    expect(page.total).toBe(5);
    expect(decodeCursor(page.nextCursor!, 'text')).toEqual({ sortKey: 'adventure', id: 2 });
  });

  it('gives no cursor when the page ends exactly at the last item', () => {
    const page = pageInMemory(ITEMS, { after: null, limit: 5 });
    expect(page.nextCursor).toBeNull();
  });

  it('walks the whole list without repeating or skipping an item', () => {
    const seen: number[] = [];
    let cursor: string | null = null;
    do {
      const request = toPageRequest({ limit: 2, ...(cursor ? { cursor } : {}) }, 'text');
      const page = pageInMemory(ITEMS, request);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual(ITEMS.map((item) => item.id));
  });

  it('resumes after the cursor position even when that item has gone', () => {
    const cursor = encodeCursor({ sortKey: 'Comedy', id: 9 });
    const withoutComedy = ITEMS.filter((item) => item.id !== 9);
    const page = pageInMemory(withoutComedy, toPageRequest({ cursor, limit: 10 }, 'text'));
    expect(page.items.map((item) => item.name)).toEqual(['Drama', 'Mystery']);
    expect(page.total).toBe(4);
  });

  it('refuses a cursor of the wrong kind before paging', () => {
    const numberCursor = encodeCursor({ sortKey: 42, id: 1 });
    expect(() => toPageRequest({ cursor: numberCursor }, 'text')).toThrow(AppError);
  });
});
