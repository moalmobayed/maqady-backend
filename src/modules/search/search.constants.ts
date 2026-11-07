/** The shortest and longest search a route accepts, after trimming (design §13.2). */
export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;

/** A typo-tolerant (trigram word similarity) match is tried from this many characters on. */
export const FUZZY_MIN_LENGTH = 3;

/** Hits per group: the customer site's search, and the dashboard's (design §13.2). */
export const PUBLIC_GROUP_LIMIT = 5;
export const STAFF_GROUP_LIMIT = 10;

/** The staff search answers with personal data: no shared cache may keep it. */
export const STAFF_SEARCH_CACHE_CONTROL = 'private, no-store';
