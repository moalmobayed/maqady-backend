import {
  anyMatchSql,
  bindingsOf,
  matchSql,
  NO_MATCH_TIER,
  scoreSql,
  searchTermsOf,
  tierSql,
} from '../../../../src/modules/search/search-terms';
import type { SearchColumn } from '../../../../src/modules/search/types';

const NAME: SearchColumn = { sql: 'p.full_name', kind: 'name' };
const EMAIL: SearchColumn = { sql: 'c.email::text', kind: 'text' };
const PHONE: SearchColumn = { sql: 'c.phone', kind: 'phone' };

describe('searchTermsOf', () => {
  it('trims the query and builds the prefix and substring patterns', () => {
    expect(searchTermsOf('  Inception ')).toEqual({
      text: 'Inception',
      prefix: 'Inception%',
      contains: '%Inception%',
      fuzzy: true,
      phoneContains: null,
      reference: null,
    });
  });

  it('escapes %, _ and the escape character, so they are plain characters', () => {
    expect(searchTermsOf('50%_\\x')).toMatchObject({
      text: '50%_\\x',
      prefix: '50\\%\\_\\\\x%',
      contains: '%50\\%\\_\\\\x%',
    });
  });

  it('tries a typo-tolerant match from 3 characters only', () => {
    expect(searchTermsOf('ab').fuzzy).toBe(false);
    expect(searchTermsOf('abc').fuzzy).toBe(true);
  });

  it('also looks for an Egyptian local mobile in its E.164 form', () => {
    expect(searchTermsOf('01012345678').phoneContains).toBe('%+201012345678%');
    expect(searchTermsOf('+201012345678').phoneContains).toBeNull();
    expect(searchTermsOf('0101234567').phoneContains).toBeNull();
  });

  it('recognises a whole booking reference in any case, and nothing shorter', () => {
    expect(searchTermsOf(' mq-7k3p9q ').reference).toBe('MQ-7K3P9Q');
    expect(searchTermsOf('MQ-7K3P9').reference).toBeNull();
    expect(searchTermsOf('7K3P9Q').reference).toBeNull();
    // 0, O, 1, I and L never appear in a reference.
    expect(searchTermsOf('MQ-7K3P9O').reference).toBeNull();
  });
});

describe('the SQL fragments', () => {
  const fuzzy = searchTermsOf('Layla');
  const short = searchTermsOf('La');
  const mobile = searchTermsOf('01012345678');

  it('ranks a column exact, prefix, substring, then typo-tolerant for a name', () => {
    expect(tierSql(NAME, fuzzy)).toBe(
      `CASE WHEN lower(p.full_name) = lower(:q) THEN 0 WHEN p.full_name ILIKE :prefix THEN 1 WHEN p.full_name ILIKE :contains THEN 2 WHEN :q <% p.full_name THEN 3 ELSE ${NO_MATCH_TIER} END`,
    );
    expect(tierSql(NAME, short)).not.toContain('<%');
    expect(tierSql(EMAIL, fuzzy)).not.toContain('<%');
  });

  it('matches a name by substring or typo, an email by substring, a phone also in E.164', () => {
    expect(matchSql(NAME, fuzzy)).toBe('(p.full_name ILIKE :contains OR :q <% p.full_name)');
    expect(matchSql(NAME, short)).toBe('(p.full_name ILIKE :contains)');
    expect(matchSql(EMAIL, fuzzy)).toBe('(c.email::text ILIKE :contains)');
    expect(matchSql(PHONE, fuzzy)).toBe('(c.phone ILIKE :contains)');
    expect(matchSql(PHONE, mobile)).toBe(
      '(c.phone ILIKE :contains OR c.phone ILIKE :phoneContains)',
    );
    expect(tierSql(PHONE, mobile)).toContain(
      'WHEN c.phone ILIKE :contains OR c.phone ILIKE :phoneContains THEN 2',
    );
    expect(anyMatchSql([NAME, EMAIL], short)).toBe(
      '((p.full_name ILIKE :contains) OR (c.email::text ILIKE :contains))',
    );
  });

  it('scores several columns by the best tier, the earlier column first within a tier', () => {
    const score = scoreSql([NAME, EMAIL, PHONE], short);
    expect(score.startsWith('LEAST(')).toBe(true);
    expect(score).toContain(`(${tierSql(NAME, short)}) * 3 + 0`);
    expect(score).toContain(`(${tierSql(EMAIL, short)}) * 3 + 1`);
    expect(score).toContain(`(${tierSql(PHONE, short)}) * 3 + 2`);
    expect(scoreSql([NAME], short)).toBe(`(${tierSql(NAME, short)}) * 1 + 0`);
  });

  it('never puts the query itself into the SQL: everything is a named binding', () => {
    const terms = searchTermsOf("Robert'); DROP TABLE movies; --");
    for (const sql of [tierSql(NAME, terms), matchSql(NAME, terms), scoreSql([NAME], terms)]) {
      expect(sql).not.toContain('Robert');
    }
    expect(bindingsOf(terms, 6)).toEqual({
      q: terms.text,
      prefix: terms.prefix,
      contains: terms.contains,
      phoneContains: null,
      limit: 6,
    });
  });
});
