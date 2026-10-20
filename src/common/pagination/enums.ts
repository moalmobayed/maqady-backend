/**
 * What a list sorts by, so a cursor's sort key can be checked before it reaches SQL:
 *
 * - `instant`: an ISO 8601 time with its offset, as `formatCairoIso()` or `Date.toISOString()`
 *   writes it;
 * - `text`: a string, such as a name;
 * - `number`: a finite number.
 *
 * A null sort key (a nullable sort column) is accepted for every kind.
 */
export const SORT_KEY_KINDS = ['instant', 'text', 'number'] as const;
