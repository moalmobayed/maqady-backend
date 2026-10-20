import { KIND_RULES, ASPECT_TOLERANCE } from '../media/media.constants';
import type { StoredImage } from '../media/types';
import { MOVIE_STATUS_TRANSITIONS } from './catalog.constants';
import { FEATURE_BLOCKERS, PUBLIC_MOVIE_STATUSES, PUBLISH_REQUIREMENTS } from './enums';
import type {
  FeatureBlocker,
  MovieFeatureState,
  MoviePublishState,
  MovieStatus,
  PublicMovieStatus,
  PublishRequirement,
} from './types';

/** The catalog's pure rules (spec "Decisions"), shared by the services and their tests. */

/** True when customers see a movie of this status: Coming soon or Now showing. */
export function isPublicStatus(status: MovieStatus): status is PublicMovieStatus {
  return (PUBLIC_MOVIE_STATUSES as readonly MovieStatus[]).includes(status);
}

/** True when an admin may move a movie from `from` to `to` (a different status). */
export function canTransition(from: MovieStatus, to: MovieStatus): boolean {
  return MOVIE_STATUS_TRANSITIONS[from].includes(to);
}

/** What a movie still lacks to be public, in `PUBLISH_REQUIREMENTS` order. A poster is not required. */
export function missingPublishRequirements(state: MoviePublishState): PublishRequirement[] {
  const present: Readonly<Record<PublishRequirement, boolean>> = {
    synopsis: state.synopsis !== null,
    runtimeMinutes: state.runtimeMinutes !== null,
    releaseDate: state.releaseDate !== null,
    genres: state.genreCount > 0,
  };
  return PUBLISH_REQUIREMENTS.filter((requirement) => !present[requirement]);
}

/** Why a movie can't be featured: it must be public and have a hero video (design §9). */
export function featureBlockers(state: MovieFeatureState): FeatureBlocker[] {
  const blocked: Readonly<Record<FeatureBlocker, boolean>> = {
    not_public: !isPublicStatus(state.status),
    no_hero_video: state.heroVideoId === null,
  };
  return FEATURE_BLOCKERS.filter((blocker) => blocked[blocker]);
}

/**
 * True when a movie photo can be the backdrop (PRD A2 "backdrop picked from the photos"): 16:9
 * within U4a's tolerance, and at least the backdrop minimum, by the photo's stored source size.
 */
export function isBackdropShaped(image: StoredImage): boolean {
  const rule = KIND_RULES.backdrop;
  if (rule.aspect === null) return true;
  const [ratioWidth, ratioHeight] = rule.aspect;
  const ratio = image.sourceWidth / image.sourceHeight / (ratioWidth / ratioHeight);
  return (
    Math.abs(ratio - 1) <= ASPECT_TOLERANCE + 1e-9 &&
    image.sourceWidth >= rule.minWidth &&
    image.sourceHeight >= rule.minHeight
  );
}

/** The backdrop's shape rules, as `IMAGE_WRONG_SHAPE` details give them. */
export function backdropShapeDetails(image: StoredImage): Readonly<Record<string, unknown>> {
  const rule = KIND_RULES.backdrop;
  return {
    kind: 'backdrop',
    aspect: rule.aspect === null ? null : `${rule.aspect[0]}:${rule.aspect[1]}`,
    minWidth: rule.minWidth,
    minHeight: rule.minHeight,
    width: image.sourceWidth,
    height: image.sourceHeight,
  };
}

/**
 * A `LIKE` pattern matching `text` anywhere, case-insensitively with `ILIKE`: `%`, `_` and `\`
 * in the search match themselves.
 */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
