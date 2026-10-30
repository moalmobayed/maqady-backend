import { LOCAL_MOBILE_PATTERN, REFERENCE_PATTERN } from '../bookings/bookings.constants';
import { FUZZY_MIN_LENGTH } from './search.constants';
import type { SearchBindings, SearchColumn, SearchTerms } from './types';

/** The tier of a column that did not match: above every real tier. */
export const NO_MATCH_TIER = 9;

/** `%`, `_` and the escape character `\` are literal in a search, never wildcards. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * What a search string looks for (design §13.2; PRD "Search"): a case-insensitive substring, a
 * typo-tolerant match on names and titles from `FUZZY_MIN_LENGTH` characters, an Egyptian mobile
 * typed locally (`01012345678`) also in its stored E.164 form (`+201012345678`), and a whole
 * booking reference in any case. The query is trimmed; its length is checked by `SearchQuery`.
 */
export function searchTermsOf(q: string): SearchTerms {
  const text = q.trim();
  const local = LOCAL_MOBILE_PATTERN.exec(text);
  const reference = text.toUpperCase();
  return {
    text,
    prefix: `${escapeLike(text)}%`,
    contains: `%${escapeLike(text)}%`,
    fuzzy: text.length >= FUZZY_MIN_LENGTH,
    phoneContains: local ? `%+20${local[1]}%` : null,
    reference: REFERENCE_PATTERN.test(reference) ? reference : null,
  };
}

/** The named bindings of a search query, `limit` rows at most. */
export function bindingsOf(terms: SearchTerms, limit: number): SearchBindings {
  return {
    q: terms.text,
    prefix: terms.prefix,
    contains: terms.contains,
    phoneContains: terms.phoneContains,
    limit,
  };
}

/**
 * How well one column matched, as SQL on the named bindings: 0 the whole value (any case), 1 a
 * prefix, 2 a substring, 3 only typo-tolerant (`:q <% column`, pg_trgm word similarity at least
 * `pg_trgm.word_similarity_threshold`), `NO_MATCH_TIER` otherwise (or NULL).
 */
export function tierSql(column: SearchColumn, terms: SearchTerms): string {
  const c = column.sql;
  const substring =
    column.kind === 'phone' && terms.phoneContains !== null
      ? `${c} ILIKE :contains OR ${c} ILIKE :phoneContains`
      : `${c} ILIKE :contains`;
  const fuzzy = column.kind === 'name' && terms.fuzzy ? ` WHEN :q <% ${c} THEN 3` : '';
  return `CASE WHEN lower(${c}) = lower(:q) THEN 0 WHEN ${c} ILIKE :prefix THEN 1 WHEN ${substring} THEN 2${fuzzy} ELSE ${NO_MATCH_TIER} END`;
}

/**
 * Whether one column matched, as SQL a trigram GIN index serves: a substring (`ILIKE`), or for a
 * name a typo-tolerant match (`<%`), or for a phone its E.164 form.
 */
export function matchSql(column: SearchColumn, terms: SearchTerms): string {
  const c = column.sql;
  const parts = [`${c} ILIKE :contains`];
  if (column.kind === 'name' && terms.fuzzy) parts.push(`:q <% ${c}`);
  if (column.kind === 'phone' && terms.phoneContains !== null) {
    parts.push(`${c} ILIKE :phoneContains`);
  }
  return `(${parts.join(' OR ')})`;
}

/** True when any of the columns matched. */
export function anyMatchSql(columns: readonly SearchColumn[], terms: SearchTerms): string {
  return `(${columns.map((column) => matchSql(column, terms)).join(' OR ')})`;
}

/**
 * A row's rank over several columns, lowest best: the best tier, and within a tier the earlier
 * column (`tier × columns + position`), so a title beats a cast name, a name an email.
 */
export function scoreSql(columns: readonly SearchColumn[], terms: SearchTerms): string {
  const scores = columns.map(
    (column, position) => `(${tierSql(column, terms)}) * ${columns.length} + ${position}`,
  );
  return scores.length === 1 ? scores[0]! : `LEAST(${scores.join(', ')})`;
}
