import type { StoredImage } from '../../../../src/modules/media/types';
import { MOVIE_STATUSES } from '../../../../src/modules/catalog/enums';
import {
  backdropShapeDetails,
  canTransition,
  containsPattern,
  featureBlockers,
  isBackdropShaped,
  isPublicStatus,
  missingPublishRequirements,
} from '../../../../src/modules/catalog/movie-rules';

function image(sourceWidth: number, sourceHeight: number): StoredImage {
  const variant = { path: 'gallery/x/small.webp', width: 1, height: 1, bytes: 1 };
  return {
    id: 1,
    kind: 'gallery',
    storagePrefix: 'gallery/00000000-0000-0000-0000-000000000000',
    variants: { small: variant, medium: variant, large: variant },
    sourceWidth,
    sourceHeight,
    createdByStaffId: 1,
    createdAt: new Date('2026-10-16T12:00:00Z'),
  };
}

describe('canTransition', () => {
  const allowed: Record<string, string[]> = {
    draft: ['coming_soon', 'now_showing', 'archived'],
    coming_soon: ['draft', 'now_showing', 'archived'],
    now_showing: ['archived'],
    archived: ['coming_soon', 'now_showing'],
  };
  const pairs = MOVIE_STATUSES.flatMap((from) =>
    MOVIE_STATUSES.filter((to) => to !== from).map((to) => [from, to] as const),
  );

  it.each(pairs)('%s → %s follows the transition table', (from, to) => {
    expect(canTransition(from, to)).toBe(allowed[from]!.includes(to));
  });

  it('never lets a Now showing movie go back to draft or Coming soon', () => {
    expect(canTransition('now_showing', 'draft')).toBe(false);
    expect(canTransition('now_showing', 'coming_soon')).toBe(false);
  });
});

describe('isPublicStatus', () => {
  it('is true for Coming soon and Now showing only', () => {
    expect(MOVIE_STATUSES.filter(isPublicStatus)).toEqual(['coming_soon', 'now_showing']);
  });
});

describe('missingPublishRequirements', () => {
  const complete = {
    synopsis: 'A synopsis.',
    runtimeMinutes: 120,
    releaseDate: '2026-10-01',
    genreCount: 1,
  };

  it('is empty for a complete movie (a poster is not required)', () => {
    expect(missingPublishRequirements(complete)).toEqual([]);
  });

  it.each([
    ['synopsis', { synopsis: null }],
    ['runtimeMinutes', { runtimeMinutes: null }],
    ['releaseDate', { releaseDate: null }],
    ['genres', { genreCount: 0 }],
  ])('names %s when it is missing', (name, change) => {
    expect(missingPublishRequirements({ ...complete, ...change })).toEqual([name]);
  });

  it('lists everything missing in a fixed order', () => {
    expect(
      missingPublishRequirements({
        synopsis: null,
        runtimeMinutes: null,
        releaseDate: null,
        genreCount: 0,
      }),
    ).toEqual(['synopsis', 'runtimeMinutes', 'releaseDate', 'genres']);
  });
});

describe('featureBlockers', () => {
  it.each([
    ['now_showing', 7, []],
    ['coming_soon', 7, []],
    ['draft', 7, ['not_public']],
    ['archived', 7, ['not_public']],
    ['now_showing', null, ['no_hero_video']],
    ['draft', null, ['not_public', 'no_hero_video']],
  ] as const)('a %s movie with hero %s is blocked by %j', (status, heroVideoId, blockers) => {
    expect(featureBlockers({ status, heroVideoId })).toEqual(blockers);
  });
});

describe('isBackdropShaped', () => {
  it.each([
    [1920, 1080, true],
    [1280, 720, true],
    [1920, 1100, true],
    [1950, 1080, true],
    [1600, 1200, false],
    [1279, 720, false],
    [1280, 719, false],
    [1080, 1920, false],
  ])('%i × %i is %s', (width, height, expected) => {
    expect(isBackdropShaped(image(width, height))).toBe(expected);
  });

  it("describes the rule with U4a's IMAGE_WRONG_SHAPE details", () => {
    expect(backdropShapeDetails(image(1200, 900))).toEqual({
      kind: 'backdrop',
      aspect: '16:9',
      minWidth: 1280,
      minHeight: 720,
      width: 1200,
      height: 900,
    });
  });
});

describe('containsPattern', () => {
  it('matches anywhere and escapes LIKE wildcards and the escape character', () => {
    expect(containsPattern('light')).toBe('%light%');
    expect(containsPattern('100%')).toBe('%100\\%%');
    expect(containsPattern('a_b')).toBe('%a\\_b%');
    expect(containsPattern('back\\slash')).toBe('%back\\\\slash%');
  });
});
