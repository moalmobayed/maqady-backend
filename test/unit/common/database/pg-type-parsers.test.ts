import { types } from 'pg';
import {
  installPgTypeParsers,
  mapArray,
  parseBigint,
  parseDate,
  parseNumeric,
  PG_TYPE,
} from '../../../../src/common/database/pg-type-parsers';

const parserFor = (oid: number) =>
  (types.getTypeParser as (oid: number) => (value: string) => unknown)(oid);

describe('pg type parsers', () => {
  describe('parseBigint', () => {
    it('turns BIGINT text into a number', () => {
      expect(parseBigint('42')).toBe(42);
      expect(parseBigint('-7')).toBe(-7);
      expect(parseBigint('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('refuses a value beyond the safe integer range instead of losing precision', () => {
      expect(() => parseBigint('9007199254740993')).toThrow(RangeError);
      expect(() => parseBigint('-9223372036854775808')).toThrow(RangeError);
    });
  });

  it('turns NUMERIC text into a float', () => {
    expect(parseNumeric('30.044420')).toBeCloseTo(30.04442, 6);
    expect(parseNumeric('-31.235712')).toBeCloseTo(-31.235712, 6);
  });

  it('keeps DATE as the YYYY-MM-DD text, never a shifted Date', () => {
    expect(parseDate('2026-10-16')).toBe('2026-10-16');
  });

  it('maps through nested arrays and keeps NULLs', () => {
    expect(mapArray(['1', null, ['2', '3']], parseBigint)).toEqual([1, null, [2, 3]]);
  });

  describe('installPgTypeParsers', () => {
    beforeAll(() => installPgTypeParsers());

    it('registers the scalar parsers with node-pg', () => {
      expect(parserFor(PG_TYPE.INT8)('123')).toBe(123);
      expect(parserFor(PG_TYPE.NUMERIC)('1.5')).toBe(1.5);
      expect(parserFor(PG_TYPE.DATE)('2026-03-27')).toBe('2026-03-27');
    });

    it('registers the array parsers with node-pg', () => {
      expect(parserFor(PG_TYPE.INT8_ARRAY)('{1,2,NULL}')).toEqual([1, 2, null]);
      expect(parserFor(PG_TYPE.NUMERIC_ARRAY)('{1.25,-2}')).toEqual([1.25, -2]);
      expect(parserFor(PG_TYPE.DATE_ARRAY)('{2026-10-16,NULL}')).toEqual(['2026-10-16', null]);
    });

    it('is idempotent', () => {
      installPgTypeParsers();
      expect(parserFor(PG_TYPE.INT8)('5')).toBe(5);
    });
  });
});
