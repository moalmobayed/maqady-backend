import type { Response } from 'supertest';
import type { TestApp } from './types';

/**
 * CSV helpers for the export tests (U19): a strict RFC 4180 reader, independent of the code
 * under test, and the export routes.
 *
 * @example
 * const response = await exportCsv(testApp, admin.authorization, 'bookings', { status: 'confirmed' });
 * const rows = csvObjects(response.text);
 */

const BOM = String.fromCharCode(0xfeff);

/**
 * The records of a CSV text: fields separated by commas, records by CRLF, a field in double
 * quotes when it holds a comma, a quote (doubled) or a line break. Throws on anything else, so a
 * malformed file fails the test.
 */
export function parseCsv(text: string): string[][] {
  if (!text.startsWith(BOM)) throw new Error('parseCsv: the file has no byte-order mark');
  const body = text.slice(BOM.length);
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let index = 0;
  while (index < body.length) {
    const char = body[index]!;
    if (char === '"' && field === '') {
      index += 1;
      for (;;) {
        if (index >= body.length) throw new Error('parseCsv: an unterminated quoted field');
        if (body[index] === '"') {
          if (body[index + 1] === '"') {
            field += '"';
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        field += body[index];
        index += 1;
      }
      const next = body[index];
      if (next !== undefined && next !== ',' && next !== '\r') {
        throw new Error(`parseCsv: text after a quoted field at ${index}`);
      }
      continue;
    }
    if (char === ',') {
      record.push(field);
      field = '';
      index += 1;
      continue;
    }
    if (char === '\r') {
      if (body[index + 1] !== '\n') throw new Error(`parseCsv: a bare CR at ${index}`);
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      index += 2;
      continue;
    }
    if (char === '\n') throw new Error(`parseCsv: a bare LF at ${index}`);
    field += char;
    index += 1;
  }
  if (field !== '' || record.length > 0) throw new Error('parseCsv: the last record has no CRLF');
  return records;
}

/** The records after the header, each as `header → cell`. */
export function csvObjects(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error('csvObjects: no header row');
  return rows.map((row) => {
    if (row.length !== header.length) {
      throw new Error(`csvObjects: ${row.length} cells under ${header.length} headers`);
    }
    return Object.fromEntries(header.map((name, column) => [name, row[column]!]));
  });
}

/** The header row of a CSV text. */
export function csvHeader(text: string): string[] {
  return parseCsv(text)[0] ?? [];
}

/** `GET /admin/exports/<dataset>.csv` with these query parameters; the file is `response.text`. */
export function exportCsv(
  testApp: TestApp,
  authorization: string,
  dataset: string,
  query: Readonly<Record<string, string | number | undefined>> = {},
): Promise<Response> {
  return testApp
    .http()
    .get(`/api/v1/admin/exports/${dataset}.csv`)
    .query(query)
    .set('Authorization', authorization);
}

/** Every item of a cursor-paginated admin list, walked page by page with `limit`. */
export async function allPages<T>(
  testApp: TestApp,
  authorization: string,
  path: string,
  query: Readonly<Record<string, string | number | undefined>> = {},
  limit = 2,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  do {
    const response: Response = await testApp
      .http()
      .get(path)
      .query({ ...query, limit, ...(cursor === null ? {} : { cursor }) })
      .set('Authorization', authorization);
    if (response.status !== 200) {
      throw new Error(`allPages ${path}: ${response.status} ${JSON.stringify(response.body)}`);
    }
    items.push(...(response.body.items as T[]));
    cursor = response.body.nextCursor as string | null;
  } while (cursor !== null);
  return items;
}
