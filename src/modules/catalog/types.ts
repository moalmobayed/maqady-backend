import type { CalendarDate } from '../../common/time/types';
import type { StoredImage } from '../media/types';
import type {
  AGE_RATINGS,
  CREDIT_ROLES,
  FEATURE_BLOCKERS,
  MOVIE_PHOTO_KINDS,
  MOVIE_STATUSES,
  PUBLIC_MOVIE_STATUSES,
  PUBLISH_REQUIREMENTS,
  ROLE_GROUPS,
  VIDEO_KINDS,
} from './enums';

export type MovieStatus = (typeof MOVIE_STATUSES)[number];
export type PublicMovieStatus = (typeof PUBLIC_MOVIE_STATUSES)[number];
export type AgeRating = (typeof AGE_RATINGS)[number];
export type CreditRole = (typeof CREDIT_ROLES)[number];
export type RoleGroup = (typeof ROLE_GROUPS)[number];
export type VideoKind = (typeof VIDEO_KINDS)[number];
export type MoviePhotoKind = (typeof MOVIE_PHOTO_KINDS)[number];
export type PublishRequirement = (typeof PUBLISH_REQUIREMENTS)[number];
export type FeatureBlocker = (typeof FEATURE_BLOCKERS)[number];

// --- Rows -----------------------------------------------------------------------------------

/** A `genres` row. */
export interface GenreRow {
  readonly id: number;
  readonly name: string;
  readonly slug: string;
}

/** A `movie_genres` row joined with its genre, in display order. */
export interface MovieGenreRow extends GenreRow {
  readonly movie_id: number;
  readonly sort_order: number;
}

/** A `movies` row. */
export interface MovieRow {
  readonly id: number;
  readonly title: string;
  readonly status: MovieStatus;
  readonly synopsis: string | null;
  readonly runtime_minutes: number | null;
  readonly release_date: CalendarDate | null;
  readonly age_rating: AgeRating;
  readonly language: string | null;
  readonly country: string | null;
  readonly production_company: string | null;
  readonly budget_label: string | null;
  readonly filming_locations: string | null;
  readonly poster_image_id: number | null;
  readonly backdrop_photo_id: number | null;
  readonly hero_video_id: number | null;
  readonly featured_position: number | null;
  readonly updated_by_staff_id: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** The columns of a new `movies` row. */
export type NewMovieRow = Omit<MovieRow, 'id'>;

/** The columns a movie write may change. */
export type MovieRowUpdate = Partial<Omit<MovieRow, 'id' | 'created_at'>>;

/** Per-movie counts for the admin list. */
export interface MovieCountsRow {
  readonly id: number;
  readonly photo_count: number;
  readonly video_count: number;
  readonly credit_count: number;
}

/** A `movie_photos` row. */
export interface MoviePhotoRow {
  readonly id: number;
  readonly movie_id: number;
  readonly image_id: number;
  readonly kind: MoviePhotoKind;
  readonly caption: string | null;
  readonly sort_order: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export type NewMoviePhotoRow = Omit<MoviePhotoRow, 'id'>;

export type MoviePhotoRowUpdate = Partial<Pick<MoviePhotoRow, 'kind' | 'caption' | 'updated_at'>>;

/** A `movie_videos` row. */
export interface MovieVideoRow {
  readonly id: number;
  readonly movie_id: number;
  readonly youtube_id: string;
  readonly kind: VideoKind;
  readonly title: string;
  readonly duration_seconds: number | null;
  readonly sort_order: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export type NewMovieVideoRow = Omit<MovieVideoRow, 'id'>;

export type MovieVideoRowUpdate = Partial<
  Pick<MovieVideoRow, 'kind' | 'title' | 'duration_seconds' | 'updated_at'>
>;

/** A `people` row. */
export interface PersonRow {
  readonly id: number;
  readonly full_name: string;
  readonly birth_date: CalendarDate | null;
  readonly birth_place: string | null;
  readonly nationality: string | null;
  readonly bio: string | null;
  readonly photo_image_id: number | null;
  readonly instagram_url: string | null;
  readonly imdb_url: string | null;
  readonly website_url: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export type NewPersonRow = Omit<PersonRow, 'id'>;

export type PersonRowUpdate = Partial<Omit<PersonRow, 'id' | 'created_at'>>;

/** A `person_roles` row. */
export interface PersonRoleRow {
  readonly person_id: number;
  readonly role: CreditRole;
}

/** A `movie_credits` row. */
export interface MovieCreditRow {
  readonly id: number;
  readonly movie_id: number;
  readonly person_id: number;
  readonly role: CreditRole;
  readonly character_name: string | null;
  readonly sort_order: number;
}

export type NewMovieCreditRow = Omit<MovieCreditRow, 'id'> & { readonly created_at: Date };

/** A credit of a movie with its person, for a movie's cast and crew. */
export interface MovieCreditWithPersonRow extends MovieCreditRow {
  readonly full_name: string;
  readonly photo_image_id: number | null;
}

/** A credit of a person with its movie, for a filmography. */
export interface PersonCreditWithMovieRow extends MovieCreditRow {
  readonly title: string;
  readonly status: MovieStatus;
  readonly release_date: CalendarDate | null;
  readonly poster_image_id: number | null;
}

/** A credit's new character name. */
export interface CharacterNameChange {
  readonly id: number;
  readonly characterName: string | null;
}

/** How many credits a movie has. */
export interface MovieCreditCountRow {
  readonly movie_id: number;
  readonly count: number;
}

/** Credit counts and the credited roles of people. */
export interface PersonCreditSummaryRow {
  readonly person_id: number;
  readonly credit_count: number;
  readonly roles: CreditRole[];
}

/** One of the "known for" movies of a person in the admin list. */
export interface KnownForRow {
  readonly person_id: number;
  readonly movie_id: number;
  readonly title: string;
}

/** How many movies have a status. */
export interface StatusCountRow {
  readonly status: MovieStatus;
  readonly count: number;
}

/** A genre's count of public movies. */
export interface GenreCountRow {
  readonly genre_id: number;
  readonly count: number;
}

/** A public movie's count by status. */
export interface PublicStatusCountRow {
  readonly status: PublicMovieStatus;
  readonly count: number;
}

/** A similar movie with how many genres it shares. */
export interface SimilarMovieRow extends MovieRow {
  readonly shared: number;
}

// --- Domain ---------------------------------------------------------------------------------

/** A genre (home-page contract `GenreRef`). */
export interface GenreRef {
  readonly id: number;
  readonly name: string;
  readonly slug: string;
}

/** A YouTube video of a movie, without the derived URLs. */
export interface MovieVideo {
  readonly id: number;
  readonly youtubeId: string;
  readonly title: string;
  readonly kind: VideoKind;
  readonly durationSeconds: number | null;
  readonly position: number;
}

/** A photo of a movie. */
export interface MoviePhoto {
  readonly id: number;
  readonly kind: MoviePhotoKind;
  readonly caption: string | null;
  readonly position: number;
  readonly image: StoredImage;
}

/** A credited person, as a movie's cast and crew shows them. */
export interface CreditedPerson {
  readonly id: number;
  readonly fullName: string;
  readonly photo: StoredImage | null;
}

/** One credit of a movie's cast and crew, in display order. */
export interface MovieCredit {
  readonly id: number;
  readonly role: CreditRole;
  readonly characterName: string | null;
  readonly position: number;
  readonly person: CreditedPerson;
}

/** A public movie as cards show it (home-page contract `MovieCard`, with the synopsis). */
export interface MovieSummary {
  readonly id: number;
  readonly title: string;
  readonly status: PublicMovieStatus;
  readonly synopsis: string;
  readonly runtimeMinutes: number;
  readonly releaseDate: CalendarDate;
  readonly ageRating: AgeRating;
  /** In display order; the first is the "first genre" of Now showing cards. */
  readonly genres: readonly GenreRef[];
  readonly poster: StoredImage | null;
}

/** A public movie's page (PRD C3). */
export interface MovieDetails extends MovieSummary {
  readonly language: string | null;
  readonly country: string | null;
  readonly productionCompany: string | null;
  readonly budgetLabel: string | null;
  readonly filmingLocations: string | null;
  readonly backdrop: StoredImage | null;
  readonly heroVideo: MovieVideo | null;
  readonly photos: readonly MoviePhoto[];
  readonly videos: readonly MovieVideo[];
  readonly credits: readonly MovieCredit[];
}

/** One slide of the home carousel (home-page contract `FeaturedMovie`). */
export interface FeaturedMovie {
  readonly position: number;
  readonly movie: MovieSummary;
  readonly heroVideo: MovieVideo;
  /** The backdrop photo's image, or null when none is set. */
  readonly backdrop: StoredImage | null;
}

/**
 * Filters of the public movie lists (PRD C2), combined with AND. `genreIds` and `personIds`
 * match any of their ids, and an empty list is no filter; `movieIds` restricts the list to those
 * movies, and an empty list matches nothing (U8's "has a showtime on that date" set).
 */
export interface PublicMovieFilter {
  readonly status: PublicMovieStatus;
  /** A title or a credited person's name contains it, case-insensitively. */
  readonly q?: string;
  readonly genreIds?: readonly number[];
  readonly personIds?: readonly number[];
  readonly movieIds?: readonly number[];
}

/** The filters of the public counts: those of the list, with an optional status. */
export type PublicMovieCountFilter = Omit<PublicMovieFilter, 'status'> & {
  readonly status?: PublicMovieStatus;
};

/** The filters of the tab counts: those of the list, without the status. */
export type PublicMovieTabFilter = Omit<PublicMovieFilter, 'status'>;

/** Filters of the public people list. */
export interface PublicPersonFilter {
  readonly q?: string;
  readonly roleGroup?: RoleGroup;
}

/** A person credited on a public movie. */
export interface PublicPerson {
  readonly id: number;
  readonly fullName: string;
  readonly photo: StoredImage | null;
  /** The roles set on the person and the roles they are credited in, in `CREDIT_ROLES` order. */
  readonly roles: readonly CreditRole[];
}

/** What U7 needs to schedule a movie. */
export interface MovieSchedulingInfo {
  readonly id: number;
  readonly title: string;
  readonly status: MovieStatus;
  readonly runtimeMinutes: number | null;
}

/** A movie of any status, as the admin timeline and showtime lists show it. */
export interface MovieRef {
  readonly id: number;
  readonly title: string;
  readonly status: MovieStatus;
  readonly runtimeMinutes: number | null;
  readonly ageRating: AgeRating;
  readonly poster: StoredImage | null;
}

/** A staff member as "Last edited by" shows them. */
export interface StaffRef {
  readonly id: number;
  readonly fullName: string;
}

/** A movie as the admin editor shows it (PRD A2). */
export interface AdminMovie {
  readonly id: number;
  readonly title: string;
  readonly status: MovieStatus;
  readonly synopsis: string | null;
  readonly runtimeMinutes: number | null;
  readonly releaseDate: CalendarDate | null;
  readonly ageRating: AgeRating;
  readonly language: string | null;
  readonly country: string | null;
  readonly productionCompany: string | null;
  readonly budgetLabel: string | null;
  readonly filmingLocations: string | null;
  readonly genres: readonly GenreRef[];
  readonly poster: StoredImage | null;
  readonly backdropPhotoId: number | null;
  readonly heroVideoId: number | null;
  readonly featuredPosition: number | null;
  readonly photos: readonly MoviePhoto[];
  readonly videos: readonly MovieVideo[];
  readonly credits: readonly MovieCredit[];
  readonly publishBlockers: readonly PublishRequirement[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly updatedBy: StaffRef;
}

/** A row of the admin movie list (PRD A2). */
export interface AdminMovieListItem {
  readonly id: number;
  readonly title: string;
  readonly status: MovieStatus;
  readonly ageRating: AgeRating;
  readonly runtimeMinutes: number | null;
  readonly releaseDate: CalendarDate | null;
  readonly genres: readonly GenreRef[];
  readonly poster: StoredImage | null;
  readonly featuredPosition: number | null;
  readonly photoCount: number;
  readonly videoCount: number;
  readonly creditCount: number;
  readonly updatedAt: Date;
}

/** Filters of the admin movie list. */
export interface AdminMovieListFilter {
  readonly q?: string;
  readonly status?: MovieStatus;
}

/** How many movies have each status, with the list's search applied. */
export type StatusCounts = Readonly<Record<MovieStatus, number>>;

/** A page of the admin movie list with its status counts. */
export interface AdminMoviePage {
  readonly items: readonly AdminMovieListItem[];
  readonly nextCursor: string | null;
  readonly total: number;
  readonly statusCounts: StatusCounts;
}

/** The editable fields of a movie; absent fields stay, null clears a nullable one. */
export interface MovieFieldChanges {
  readonly title?: string;
  readonly synopsis?: string | null;
  readonly runtimeMinutes?: number | null;
  readonly releaseDate?: CalendarDate | null;
  readonly ageRating?: AgeRating;
  readonly language?: string | null;
  readonly country?: string | null;
  readonly productionCompany?: string | null;
  readonly budgetLabel?: string | null;
  readonly filmingLocations?: string | null;
  readonly genreIds?: readonly number[];
}

/** What `POST /admin/movies` creates: a draft with a title and any details. */
export type NewMovieInput = MovieFieldChanges & { readonly title: string };

/** What `PATCH /admin/movies/{id}` asks to change. */
export interface MovieChanges extends MovieFieldChanges {
  readonly status?: MovieStatus;
  readonly featuredPosition?: number | null;
  readonly heroVideoId?: number | null;
  readonly backdropPhotoId?: number | null;
}

/** The state the publishing and featuring rules judge. */
export interface MoviePublishState {
  readonly synopsis: string | null;
  readonly runtimeMinutes: number | null;
  readonly releaseDate: CalendarDate | null;
  readonly genreCount: number;
}

export interface MovieFeatureState {
  readonly status: MovieStatus;
  readonly heroVideoId: number | null;
}

/** What `PATCH /admin/movies` (bulk archive) did. */
export interface BulkArchiveResult {
  readonly archivedIds: readonly number[];
  readonly alreadyArchivedIds: readonly number[];
}

/** One credit of `PUT /admin/movies/{id}/credits`, in display order. */
export interface CreditInput {
  readonly personId: number;
  readonly role: CreditRole;
  readonly characterName: string | null;
}

/** One credit of `PUT /admin/people/{id}/credits`. */
export interface PersonCreditInput {
  readonly movieId: number;
  readonly role: CreditRole;
  readonly characterName: string | null;
}

/** The text fields sent with a movie photo upload. */
export interface MoviePhotoFields {
  readonly kind: MoviePhotoKind;
  readonly caption: string | null;
}

/** What `PATCH` of a movie photo asks to change. */
export interface MoviePhotoChanges {
  readonly kind?: MoviePhotoKind;
  readonly caption?: string | null;
  readonly position?: number;
}

/** What `POST /admin/movies/{id}/videos` adds. */
export interface NewMovieVideoInput {
  readonly youtubeId: string;
  readonly title: string;
  readonly kind: VideoKind;
  readonly durationSeconds: number | null;
}

/** What `PATCH` of a movie video asks to change. */
export interface MovieVideoChanges {
  readonly title?: string;
  readonly kind?: VideoKind;
  readonly durationSeconds?: number | null;
  readonly position?: number;
}

/** A movie on a person's filmography. */
export interface PersonCreditMovie {
  readonly id: number;
  readonly title: string;
  readonly status: MovieStatus;
  readonly releaseDate: CalendarDate | null;
  readonly poster: StoredImage | null;
}

/** One credit on a person's filmography. */
export interface PersonCredit {
  readonly id: number;
  readonly role: CreditRole;
  readonly characterName: string | null;
  readonly movie: PersonCreditMovie;
}

/** A person as the admin editor shows them (PRD A3). */
export interface AdminPerson {
  readonly id: number;
  readonly fullName: string;
  readonly birthDate: CalendarDate | null;
  readonly birthPlace: string | null;
  readonly nationality: string | null;
  readonly bio: string | null;
  readonly photo: StoredImage | null;
  readonly instagramUrl: string | null;
  readonly imdbUrl: string | null;
  readonly websiteUrl: string | null;
  readonly roles: readonly CreditRole[];
  readonly creditedRoles: readonly CreditRole[];
  readonly credits: readonly PersonCredit[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A movie a person is known for, in the admin people list. */
export interface KnownForMovie {
  readonly id: number;
  readonly title: string;
}

/** A row of the admin people list. */
export interface AdminPersonListItem {
  readonly id: number;
  readonly fullName: string;
  readonly photo: StoredImage | null;
  readonly roles: readonly CreditRole[];
  readonly birthYear: number | null;
  readonly birthPlace: string | null;
  readonly creditCount: number;
  readonly knownFor: readonly KnownForMovie[];
}

/** Filters of the admin people list. */
export interface AdminPersonListFilter {
  readonly q?: string;
  readonly roleGroup?: RoleGroup;
}

/** The editable fields of a person; absent fields stay, null clears a nullable one. */
export interface PersonChanges {
  readonly fullName?: string;
  readonly birthDate?: CalendarDate | null;
  readonly birthPlace?: string | null;
  readonly nationality?: string | null;
  readonly bio?: string | null;
  readonly instagramUrl?: string | null;
  readonly imdbUrl?: string | null;
  readonly websiteUrl?: string | null;
  readonly roles?: readonly CreditRole[];
}

/** What `POST /admin/people` creates. */
export type NewPersonInput = PersonChanges & { readonly fullName: string };

/**
 * A rule that can refuse a movie's deletion (design §9). It runs in the delete's transaction,
 * with the movie row locked `FOR UPDATE`, and answers true to block. U7 registers
 * `has_showtimes`, U10 `has_bookings`.
 */
export interface MovieDeletionBlocker {
  readonly key: string;
  blocks(movieId: number): Promise<boolean>;
}

/** The parts of a YouTube host rule: which paths carry the video id. */
export interface YoutubeHostRule {
  readonly watch: boolean;
  readonly shorts: boolean;
  readonly embed: boolean;
  readonly shortLink: boolean;
}

/** Turns a read model into the response body an upload stores with its idempotency key. */
export type Presenter<Model, Body> = (model: Model) => Body;

/** The column changes a movie edit makes, and the API names of the fields that changed. */
export interface MovieRowDiff {
  readonly columns: MovieRowUpdate;
  readonly changedFields: readonly string[];
}

/** The column changes a person edit makes, and the API names of the fields that changed. */
export interface PersonRowDiff {
  readonly columns: PersonRowUpdate;
  readonly changedFields: readonly string[];
}
