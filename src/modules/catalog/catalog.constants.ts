import type { AgeRating, CreditRole, MovieStatus, RoleGroup, YoutubeHostRule } from './types';

/** A movie has at most five genres, in display order (`chk_movie_genres_sort_order`). */
export const MAX_GENRES_PER_MOVIE = 5;

/** Free-tier storage (PRD "Free hosting limits"): photos and videos per movie. */
export const MAX_MOVIE_PHOTOS = 30;
export const MAX_MOVIE_VIDEOS = 20;

/** Credits per movie (`chk_movie_credits_sort_order`) and per person-side replace. */
export const MAX_CREDITS = 200;

/** Movies one bulk archive may change. */
export const MAX_BULK_ARCHIVE = 100;

/** The home carousel's positions (PRD call 10: up to 5). */
export const FEATURED_POSITION_MIN = 1;
export const FEATURED_POSITION_MAX = 5;

export const MAX_RUNTIME_MINUTES = 600;
/** Ten hours: anything longer is a typo. */
export const MAX_VIDEO_DURATION_SECONDS = 36_000;

/** "Add movie" opens a blank editor with 12+ (design inventory A2). */
export const DEFAULT_AGE_RATING: AgeRating = '12+';

/** Column limits, mirrored by the migrations. */
export const TEXT_LIMITS = {
  title: 200,
  synopsis: 600,
  language: 80,
  country: 80,
  productionCompany: 120,
  budgetLabel: 40,
  filmingLocations: 200,
  characterName: 120,
  photoCaption: 200,
  videoTitle: 120,
  fullName: 120,
  birthPlace: 120,
  nationality: 80,
  bio: 400,
  url: 500,
} as const;

/**
 * Status changes an admin may make (spec "Decisions"). A Now showing movie may have sold
 * tickets, so it never goes back to Draft or Coming soon; archived keeps history and may return.
 */
export const MOVIE_STATUS_TRANSITIONS: Readonly<Record<MovieStatus, readonly MovieStatus[]>> = {
  draft: ['coming_soon', 'now_showing', 'archived'],
  coming_soon: ['draft', 'now_showing', 'archived'],
  now_showing: ['archived'],
  archived: ['coming_soon', 'now_showing'],
};

/** The credit roles of each people filter (PRD A3). */
export const ROLE_GROUP_ROLES: Readonly<Record<RoleGroup, readonly CreditRole[]>> = {
  actors: ['actor', 'voice'],
  directors: ['director'],
  writers: ['writer'],
  crew: ['producer', 'cinematographer', 'composer'],
};

/** A YouTube video id: exactly 11 of `A–Z a–z 0–9 _ -` (`chk_movie_videos_youtube_id`). */
export const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** The hosts a YouTube link may have, and which of its paths carry the id (design §9). */
export const YOUTUBE_HOSTS: Readonly<Record<string, YoutubeHostRule>> = {
  'youtube.com': { watch: true, shorts: true, embed: true, shortLink: false },
  'www.youtube.com': { watch: true, shorts: true, embed: true, shortLink: false },
  'm.youtube.com': { watch: true, shorts: true, embed: true, shortLink: false },
  'music.youtube.com': { watch: true, shorts: false, embed: false, shortLink: false },
  'youtu.be': { watch: false, shorts: false, embed: false, shortLink: true },
  'youtube-nocookie.com': { watch: false, shorts: false, embed: true, shortLink: false },
  'www.youtube-nocookie.com': { watch: false, shorts: false, embed: true, shortLink: false },
};

/** The message of a refused video link (design inventory A2). */
export const YOUTUBE_URL_MESSAGE = "That doesn't look like a YouTube video link.";

export const MAX_YOUTUBE_URL_LENGTH = 2048;

/** YouTube's privacy-enhanced player, and its thumbnails (design §9). */
export const YOUTUBE_EMBED_BASE = 'https://www.youtube-nocookie.com/embed/';
export const YOUTUBE_THUMBNAIL_BASE = 'https://i.ytimg.com/vi/';
export const YOUTUBE_WATCH_BASE = 'https://www.youtube.com/watch?v=';

/** PRD C3 "More like this: up to 4". */
export const SIMILAR_MOVIES_LIMIT = 4;

/** Searches shorter than this match too much to be useful. */
export const MIN_SEARCH_LENGTH = 2;
export const MAX_SEARCH_LENGTH = 100;

/** Social links: the hosts each box accepts (PRD A3); the website takes any host. */
export const INSTAGRAM_HOSTS = ['instagram.com', 'www.instagram.com'] as const;
export const IMDB_HOSTS = ['imdb.com', 'www.imdb.com', 'm.imdb.com'] as const;

/** The admin list shows up to two movies a person is known for. */
export const KNOWN_FOR_LIMIT = 2;
