import type { CursorPosition, PageRequest } from './types';

/**
 * A whole list, read `batchSize` rows at a time by its keyset (U19: the CSV exports), with the
 * list's own page query: `fetch` answers up to `limit + 1` rows after `after` in list order, as a
 * page of the screen does, and the extra row only tells that another batch exists. Each batch is
 * one short query; the next one runs only when the consumer asks for it, so a caller that streams
 * the batches holds one at a time. No total is counted.
 */
export async function* keysetBatches<Row>(
  fetch: (request: PageRequest) => Promise<readonly Row[]>,
  positionOf: (row: Row) => CursorPosition,
  batchSize: number,
): AsyncGenerator<readonly Row[], void, undefined> {
  let after: CursorPosition | null = null;
  for (;;) {
    const rows = await fetch({ after, limit: batchSize });
    const batch = rows.slice(0, batchSize);
    const last = batch[batch.length - 1];
    if (last === undefined) return;
    yield batch;
    if (rows.length <= batchSize) return;
    after = positionOf(last);
  }
}
