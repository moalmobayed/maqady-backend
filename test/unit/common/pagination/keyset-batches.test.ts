import { keysetBatches } from '../../../../src/common/pagination/keyset-batches';
import type { PageRequest } from '../../../../src/common/pagination/types';

interface Row {
  readonly id: number;
  readonly key: string;
}

/** Rows 1..count in descending id order, read as a keyset page query would read them. */
function pagedSource(count: number) {
  const rows: Row[] = Array.from({ length: count }, (_, index) => ({
    id: count - index,
    key: `k${count - index}`,
  }));
  const requests: PageRequest[] = [];
  const fetch = jest.fn((request: PageRequest) => {
    requests.push(request);
    const start =
      request.after === null ? 0 : rows.findIndex((row) => row.id === request.after!.id) + 1;
    return Promise.resolve(rows.slice(start, start + request.limit + 1));
  });
  return { rows, requests, fetch };
}

async function collect(batches: AsyncIterable<readonly Row[]>): Promise<number[][]> {
  const seen: number[][] = [];
  for await (const batch of batches) seen.push(batch.map((row) => row.id));
  return seen;
}

describe('keysetBatches', () => {
  it('walks the whole list in order, batch by batch, after the last row of each', async () => {
    const source = pagedSource(7);
    const batches = await collect(
      keysetBatches(source.fetch, (row) => ({ sortKey: row.key, id: row.id }), 3),
    );
    expect(batches).toEqual([[7, 6, 5], [4, 3, 2], [1]]);
    expect(source.requests).toEqual([
      { after: null, limit: 3 },
      { after: { sortKey: 'k5', id: 5 }, limit: 3 },
      { after: { sortKey: 'k2', id: 2 }, limit: 3 },
    ]);
  });

  it('stops without another query when the last batch is exactly full', async () => {
    const source = pagedSource(6);
    const batches = await collect(
      keysetBatches(source.fetch, (row) => ({ sortKey: row.key, id: row.id }), 3),
    );
    expect(batches).toEqual([
      [6, 5, 4],
      [3, 2, 1],
    ]);
    expect(source.fetch).toHaveBeenCalledTimes(2);
  });

  it('yields nothing for an empty list', async () => {
    const source = pagedSource(0);
    expect(
      await collect(keysetBatches(source.fetch, (row) => ({ sortKey: row.key, id: row.id }), 3)),
    ).toEqual([]);
    expect(source.fetch).toHaveBeenCalledTimes(1);
  });

  it('reads the next batch only when the consumer asks for it', async () => {
    const source = pagedSource(10);
    const batches = keysetBatches(source.fetch, (row) => ({ sortKey: row.key, id: row.id }), 2);
    expect(source.fetch).not.toHaveBeenCalled();
    await batches.next();
    expect(source.fetch).toHaveBeenCalledTimes(1);
    await batches.next();
    expect(source.fetch).toHaveBeenCalledTimes(2);
    await batches.return();
    expect(source.fetch).toHaveBeenCalledTimes(2);
  });
});
