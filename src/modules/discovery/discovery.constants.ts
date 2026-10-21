import type { Facility } from '../theaters/types';

/** The home page shows up to 12 movies per tab (contract `MovieCardList.items.maxItems`). */
export const HOME_LIST_LIMIT = 12;

/** Public discovery reads may be cached for a minute (contract: `GET /home`). */
export const DISCOVERY_CACHE_CONTROL = 'public, max-age=60';

/** A discovery error (`404`, `400`, `503`, …) is never kept by a cache. */
export const DISCOVERY_ERROR_CACHE_CONTROL = 'no-store';

/** The theater page lists special dates of today's cinema date and the 6 after (PRD C5). */
export const SPECIAL_DATES_AHEAD_DAYS = 7;

/** At most this many genre slugs and person ids in one `GET /movies` filter. */
export const MAX_GENRES_FILTER = 10;
export const MAX_PEOPLE_FILTER = 20;

/** The "Parking" filter of the Theaters page: free or valet parking (PRD C4). */
export const PARKING_FACILITIES: readonly Facility[] = ['free_parking', 'valet_parking'];

/** A genre slug as the catalog seeds them: lower-case words joined by hyphens. */
export const GENRE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The description shared by the discovery operations: who may call them and what is shown. */
export const PUBLIC_READ_NOTE =
  'Public; no token needed. Shows only what customers may see: Coming soon and Now showing movies, and theaters open for sales (`active`). May be cached for 60 seconds (`Cache-Control: public, max-age=60`).';

/** The movie and theater pages list showtimes of today's cinema date and the 6 after (PRD C3, C5). */
export const SHOWTIME_DAYS = 7;

/** "This weekend" is Friday and Saturday (PRD "Time" 3), as ISO weekdays of cinema dates. */
export const WEEKEND_FIRST_WEEKDAY = 5;
export const WEEKEND_LAST_WEEKDAY = 6;
