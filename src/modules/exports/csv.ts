import { Readable } from 'node:stream';
import { stringify, type Options } from 'csv-stringify/sync';
import {
  CSV_NO,
  CSV_YES,
  FORMULA_ESCAPE,
  FORMULA_TRIGGER,
  MINOR_UNITS_PER_MAJOR,
} from './exports.constants';
import type { CsvColumn, CsvValue } from './types';

/**
 * RFC 4180 records (CRLF), every field quoted when it holds a comma, a quote or any line break:
 * csv-stringify quotes the record delimiter only, so a lone `\n` or `\r` is matched explicitly.
 */
const RECORD_OPTIONS: Options = { record_delimiter: 'windows', quoted_match: /[\r\n]/ };

/**
 * A text cell made safe for spreadsheets (design §13.4, OWASP "CSV injection"): text starting
 * with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with `'`, so it reads as text
 * instead of running as a formula. Anything else is unchanged.
 */
export function escapeCsvCell(text: string): string {
  return FORMULA_TRIGGER.test(text) ? `${FORMULA_ESCAPE}${text}` : text;
}

/**
 * The text of one cell: text escaped, a number as is (never escaped: a number is no formula, and
 * a refund stays a negative amount), `yes` / `no`, and an empty cell for null.
 */
export function csvCellOf(value: CsvValue): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? CSV_YES : CSV_NO;
  return escapeCsvCell(value);
}

/** Piastres as Egyptian pounds, a decimal number for the file: 19050 → 190.5, -4000 → -40. */
export function decimalOf(minorUnits: number): number {
  return minorUnits / MINOR_UNITS_PER_MAJOR;
}

/**
 * A CSV file of `columns` over `batches`, as a stream (design §13.4): a UTF-8 byte-order mark and
 * the header row, then one chunk of records per batch, written by csv-stringify.
 *
 * - The header and the first batch are read before this resolves, so a failure up to there (the
 *   database down) is an ordinary error of the request, answered as JSON.
 * - After that the stream reads the next batch only when its consumer has taken the previous
 *   chunk (`highWaterMark` 1), so memory holds about one batch whatever the file's size.
 * - A later failure destroys the stream with the error; destroying the stream (the client went
 *   away) ends the reading of `batches`.
 */
export async function csvStream<Row>(
  batches: AsyncIterable<readonly Row[]> | Iterable<readonly Row[]>,
  columns: readonly CsvColumn<Row>[],
): Promise<Readable> {
  const chunks = csvChunks(batches, columns);
  const first = await chunks.next();
  return Readable.from(prepended(first, chunks), { objectMode: true, highWaterMark: 1 });
}

async function* csvChunks<Row>(
  batches: AsyncIterable<readonly Row[]> | Iterable<readonly Row[]>,
  columns: readonly CsvColumn<Row>[],
): AsyncGenerator<string, void, undefined> {
  const header = stringify([columns.map((column) => csvCellOf(column.header))], {
    ...RECORD_OPTIONS,
    bom: true,
  });
  let pending = header;
  for await (const batch of batches) {
    const records = batch.map((row) => columns.map((column) => csvCellOf(column.value(row))));
    // The header goes out with the first batch, so the first chunk proves the source works.
    yield pending + stringify(records, RECORD_OPTIONS);
    pending = '';
  }
  if (pending !== '') yield pending;
}

async function* prepended(
  first: IteratorResult<string, void>,
  rest: AsyncGenerator<string, void, undefined>,
): AsyncGenerator<string, void, undefined> {
  try {
    if (first.done) return;
    yield first.value;
    yield* rest;
  } finally {
    // Ends the source's reading when the stream is destroyed early.
    await rest.return();
  }
}

/** Each batch of `batches` mapped row by row, read as lazily as `batches` itself. */
export async function* mapBatches<Row, Mapped>(
  batches: AsyncIterable<readonly Row[]>,
  map: (row: Row) => Mapped,
): AsyncGenerator<readonly Mapped[], void, undefined> {
  for await (const batch of batches) yield batch.map(map);
}
