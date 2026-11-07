import { EGYPT_COUNTRY_CODE, EGYPT_LOCAL_MOBILE_PATTERN } from './customers.constants';
import type { AdminCustomerFilter, CustomerSearch, CustomerSqlCondition } from './types';

/**
 * What an admin customer search looks for (PRD A7 "Name, email or phone"): a case-insensitive
 * substring of the name, email or phone. An Egyptian mobile typed locally (`01012345678`) also
 * matches its stored E.164 form (`+201012345678`).
 */
export function customerSearchOf(q: string): CustomerSearch {
  const trimmed = q.trim();
  return {
    pattern: containsPattern(trimmed),
    phonePattern: EGYPT_LOCAL_MOBILE_PATTERN.test(trimmed)
      ? containsPattern(`${EGYPT_COUNTRY_CODE}${trimmed.slice(1)}`)
      : null,
  };
}

/**
 * A `LIKE` pattern matching `text` anywhere: `%`, `_` and the escape character `\` in the text
 * are escaped, so a search for `50%` finds "50%", never everything.
 */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/**
 * The conditions of `GET /admin/customers`, ANDed by the repository on `customers`, after the
 * live-row condition (`deleted_at IS NULL`). Every value is bound; column names are code
 * constants. The search runs on the trigram indexes of migration 0160_01; `email` is CITEXT, so
 * it is cast to text as its index is.
 */
export function customerListConditions(filter: AdminCustomerFilter): CustomerSqlCondition[] {
  const conditions: CustomerSqlCondition[] = [];
  if (filter.q !== undefined) {
    const search = customerSearchOf(filter.q);
    const phone = search.phonePattern === null ? '' : ' OR phone ILIKE ?';
    conditions.push({
      sql: `(full_name ILIKE ? OR email::text ILIKE ? OR phone ILIKE ?${phone})`,
      bindings: [
        search.pattern,
        search.pattern,
        search.pattern,
        ...(search.phonePattern === null ? [] : [search.phonePattern]),
      ],
    });
  }
  if (filter.status !== undefined) {
    conditions.push({ sql: 'status = ?', bindings: [filter.status] });
  }
  return conditions;
}
