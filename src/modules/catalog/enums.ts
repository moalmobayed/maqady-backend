/**
 * The enum-likes of the catalog (design §6.2, PRD A2–A3). Each is mirrored by a CHECK in the
 * `0070` migrations; change both together.
 */

/** A movie's status (PRD "Theaters and movies" 3). Mirrored by `chk_movies_status`. */
export const MOVIE_STATUSES = ['draft', 'coming_soon', 'now_showing', 'archived'] as const;

/** The statuses customers see (home-page contract `MovieStatus`). */
export const PUBLIC_MOVIE_STATUSES = ['coming_soon', 'now_showing'] as const;

/** Age certificates (home-page contract `AgeRating`). Mirrored by `chk_movies_age_rating`. */
export const AGE_RATINGS = ['G', 'PG', '12+', '16+', '18+'] as const;

/** The one credit role list (PRD call 8). Mirrored by `chk_movie_credits_role`, `chk_person_roles_role`. */
export const CREDIT_ROLES = [
  'actor',
  'voice',
  'director',
  'writer',
  'producer',
  'cinematographer',
  'composer',
] as const;

/** The roles that take a character name (PRD A2). Mirrored by `chk_movie_credits_character_name`. */
export const CHARACTER_ROLES = ['actor', 'voice'] as const;

/** The people filters of PRD A3: Actors (actor, voice), Directors, Writers, Crew (the rest). */
export const ROLE_GROUPS = ['actors', 'directors', 'writers', 'crew'] as const;

/** A YouTube video's type (home-page contract `VideoKind`). Mirrored by `chk_movie_videos_kind`. */
export const VIDEO_KINDS = ['trailer', 'teaser', 'clip', 'featurette'] as const;

/** A movie photo's type: Still or Behind the scenes (PRD A2). Mirrored by `chk_movie_photos_kind`. */
export const MOVIE_PHOTO_KINDS = ['still', 'behind_the_scenes'] as const;

/** What a movie needs before it is public, in the order `details.missing` lists them. */
export const PUBLISH_REQUIREMENTS = [
  'synopsis',
  'runtimeMinutes',
  'releaseDate',
  'genres',
] as const;

/** Why a movie can't be featured, in the order `details.reasons` lists them. */
export const FEATURE_BLOCKERS = ['not_public', 'no_hero_video'] as const;
