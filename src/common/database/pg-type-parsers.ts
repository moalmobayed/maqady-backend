import { types } from 'pg';
import type { ElementParser } from './types';

/** Postgres type OIDs (`pg_type.oid`) whose node-pg parsing is replaced. */
export const PG_TYPE = {
  INT8: 20,
  NUMERIC: 1700,
  DATE: 1082,
  INT8_ARRAY: 1016,
  NUMERIC_ARRAY: 1231,
  DATE_ARRAY: 1182,
  TEXT_ARRAY: 1009,
} as const;

/**
 * BIGINT as a JavaScript number. Ids, `COUNT` and `SUM` of INT stay far below 2^53 (design
 * §14.2); a value beyond the safe range fails the query instead of silently losing precision.
 */
export function parseBigint(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError('A BIGINT value is outside the safe integer range of JavaScript numbers');
  }
  return parsed;
}

/** NUMERIC as a float: coordinates and averages. Money is INT piastres, never NUMERIC. */
export function parseNumeric(value: string): number {
  return Number.parseFloat(value);
}

/**
 * DATE stays the `YYYY-MM-DD` text Postgres sends. node-pg would build a `Date` at local
 * midnight, which shifts the day in any zone west of UTC, and a cinema date is a calendar day.
 */
export function parseDate(value: string): string {
  return value;
}

/** Applies an element parser through a (possibly nested) array from node-pg's text-array parser. */
export function mapArray(values: unknown, parse: ElementParser): unknown {
  if (Array.isArray(values)) return values.map((value) => mapArray(value, parse));
  return typeof values === 'string' ? parse(values) : values;
}

// pg-types types its registry with an enum of scalar types only; array OIDs work the same way.
const setTypeParser = types.setTypeParser as (oid: number, parse: ElementParser) => void;
const getTypeParser = types.getTypeParser as (oid: number) => ElementParser;

/** Installs the parsers on node-pg's global registry. Idempotent; `createKnex()` calls it. */
export function installPgTypeParsers(): void {
  const parseTextArray = getTypeParser(PG_TYPE.TEXT_ARRAY);

  setTypeParser(PG_TYPE.INT8, parseBigint);
  setTypeParser(PG_TYPE.NUMERIC, parseNumeric);
  setTypeParser(PG_TYPE.DATE, parseDate);
  setTypeParser(PG_TYPE.INT8_ARRAY, (value) => mapArray(parseTextArray(value), parseBigint));
  setTypeParser(PG_TYPE.NUMERIC_ARRAY, (value) => mapArray(parseTextArray(value), parseNumeric));
  setTypeParser(PG_TYPE.DATE_ARRAY, (value) => mapArray(parseTextArray(value), parseDate));
}
