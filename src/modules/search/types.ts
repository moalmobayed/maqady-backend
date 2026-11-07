import type { AdminBookingListItem } from '../bookings/types';
import type { AgeRating, CreditRole, MovieStatus } from '../catalog/types';
import type { CustomerStatus } from '../customers/types';
import type { StoredImage } from '../media/types';
import type { TheaterStatus } from '../theaters/types';
import type { CATALOG_AUDIENCES, STAFF_SEARCH_GROUPS } from './enums';

/** A group of the dashboard search. */
export type StaffSearchGroup = (typeof STAFF_SEARCH_GROUPS)[number];

/** `public`: published movies, people on them, active theaters. `admin`: every status. */
export type CatalogAudience = (typeof CATALOG_AUDIENCES)[number];

/**
 * What a search string looks for (`searchTermsOf()`): the trimmed text and the `LIKE` patterns
 * built from it, wildcards escaped.
 */
export interface SearchTerms {
  /** The trimmed query, as typed. */
  readonly text: string;
  /** `text%`: the value starts with the query. */
  readonly prefix: string;
  /** `%text%`: the value contains the query. */
  readonly contains: string;
  /** True when the query is long enough for a typo-tolerant match (`FUZZY_MIN_LENGTH`). */
  readonly fuzzy: boolean;
  /** A local Egyptian mobile (`01012345678`) in its E.164 form (`+201012345678`); else null. */
  readonly phone: string | null;
  /** For an Egyptian mobile typed locally (`01012345678`), `%+201012345678%`; otherwise null. */
  readonly phoneContains: string | null;
  /** The booking reference in upper case when the whole query is one (`mq-7k3p9q`); else null. */
  readonly reference: string | null;
}

/** How a column is matched: names and titles also typo-tolerantly; phones also in E.164. */
export interface SearchColumn {
  /** A code constant (`m.title`, `c.email::text`), never input. */
  readonly sql: string;
  readonly kind: 'name' | 'text' | 'phone';
}

/**
 * The named bindings every search query shares (knex `:name` bindings). A type alias, not an
 * interface, so it is assignable to Knex's binding dictionary.
 */
export type SearchBindings = {
  readonly q: string;
  readonly prefix: string;
  readonly contains: string;
  readonly phone: string | null;
  readonly phoneContains: string | null;
  readonly limit: number;
};

// --- Rows ------------------------------------------------------------------------------------

/** A movie hit: the movie's columns and, when found by its cast, the best matching person. */
export interface MovieHitRow {
  readonly id: number;
  readonly title: string;
  readonly status: MovieStatus;
  readonly release_date: string | null;
  readonly runtime_minutes: number | null;
  readonly age_rating: AgeRating;
  readonly poster_image_id: number | null;
  readonly matched_person_id: number | null;
  readonly matched_person_name: string | null;
}

export interface PersonHitRow {
  readonly id: number;
  readonly full_name: string;
  readonly photo_image_id: number | null;
  /** The roles set on the person and those they are credited with (any order). */
  readonly roles: CreditRole[];
}

export interface TheaterHitRow {
  readonly id: number;
  readonly name: string;
  readonly status: TheaterStatus;
  readonly district: string;
  readonly city: string;
  readonly cover_image_id: number | null;
}

/** A live customer: an anonymised row is never a hit, so the name and email are set. */
export interface CustomerHitRow {
  readonly id: number;
  readonly full_name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly status: CustomerStatus;
  readonly email_verified_at: Date | null;
  readonly created_at: Date;
}

export interface BookingHitRow {
  readonly id: number;
}

// --- Results ---------------------------------------------------------------------------------

/** A query's first `limit` rows, and whether it found more (it asked for `limit + 1`). */
export interface LimitedRows<T> {
  readonly rows: readonly T[];
  readonly hasMore: boolean;
}

/** One group of results, best first, and whether more matched than were returned. */
export interface SearchGroup<T> {
  readonly items: readonly T[];
  readonly hasMore: boolean;
}

/** The person whose name made a movie a hit (PRD "movies (title or cast)"). */
export interface MatchedPerson {
  readonly id: number;
  readonly fullName: string;
}

export interface MovieHit {
  readonly id: number;
  readonly title: string;
  readonly status: MovieStatus;
  readonly releaseDate: string | null;
  readonly runtimeMinutes: number | null;
  readonly ageRating: AgeRating;
  readonly poster: StoredImage | null;
  readonly matchedPerson: MatchedPerson | null;
}

export interface PersonHit {
  readonly id: number;
  readonly fullName: string;
  readonly photo: StoredImage | null;
  /** In the credit role order. */
  readonly roles: readonly CreditRole[];
}

export interface TheaterHit {
  readonly id: number;
  readonly name: string;
  readonly status: TheaterStatus;
  readonly district: string;
  readonly city: string;
  readonly cover: StoredImage | null;
}

export interface CustomerHit {
  readonly id: number;
  readonly fullName: string;
  readonly email: string;
  readonly phone: string | null;
  readonly status: CustomerStatus;
  readonly emailVerifiedAt: Date | null;
  readonly joinedAt: Date;
}

/** `GET /search`. */
export interface PublicSearchResult {
  readonly q: string;
  readonly movies: SearchGroup<MovieHit>;
  readonly people: SearchGroup<PersonHit>;
  readonly theaters: SearchGroup<TheaterHit>;
}

/** `GET /admin/search`: a group the role may not see is null. */
export interface StaffSearchResult {
  readonly q: string;
  readonly bookings: SearchGroup<AdminBookingListItem>;
  readonly customers: SearchGroup<CustomerHit>;
  readonly movies: SearchGroup<MovieHit> | null;
  readonly people: SearchGroup<PersonHit> | null;
  readonly theaters: SearchGroup<TheaterHit> | null;
}
