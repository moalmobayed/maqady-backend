import {
  diffMovie,
  diffPerson,
  moved,
  sameOrder,
  sameSet,
} from '../../../../src/modules/catalog/movie-changes';
import type { MovieRow, PersonRow } from '../../../../src/modules/catalog/types';

const AT = new Date('2026-10-16T12:00:00Z');

const movie: MovieRow = {
  id: 1,
  title: 'The Last Lighthouse',
  status: 'draft',
  synopsis: null,
  runtime_minutes: 120,
  release_date: null,
  age_rating: '12+',
  language: null,
  country: null,
  production_company: null,
  budget_label: null,
  filming_locations: null,
  poster_image_id: null,
  backdrop_photo_id: null,
  hero_video_id: 4,
  featured_position: null,
  updated_by_staff_id: 1,
  created_at: AT,
  updated_at: AT,
};

const person: PersonRow = {
  id: 1,
  full_name: 'Karim Fahmy',
  birth_date: null,
  birth_place: null,
  nationality: 'Egyptian',
  bio: null,
  photo_image_id: null,
  instagram_url: null,
  imdb_url: null,
  website_url: null,
  created_at: AT,
  updated_at: AT,
};

describe('diffMovie', () => {
  it('keeps only sent fields that differ, as columns and API names', () => {
    expect(
      diffMovie(movie, {
        title: 'The Last Lighthouse',
        runtimeMinutes: 128,
        synopsis: 'New.',
        heroVideoId: null,
        budgetLabel: undefined,
      }),
    ).toEqual({
      columns: { runtime_minutes: 128, synopsis: 'New.', hero_video_id: null },
      changedFields: ['synopsis', 'runtimeMinutes', 'heroVideoId'],
    });
  });

  it('ignores genres, status and the featured position, which the service judges', () => {
    expect(diffMovie(movie, { genreIds: [1], status: 'archived', featuredPosition: 1 })).toEqual({
      columns: {},
      changedFields: [],
    });
  });
});

describe('diffPerson', () => {
  it('keeps only sent fields that differ', () => {
    expect(
      diffPerson(person, { nationality: 'Egyptian', bio: 'Actor.', roles: ['actor'] }),
    ).toEqual({
      columns: { bio: 'Actor.' },
      changedFields: ['bio'],
    });
  });
});

describe('moved', () => {
  it('moves one item to a place and keeps the others in order', () => {
    expect(moved([1, 2, 3, 4], 3, 0)).toEqual([3, 1, 2, 4]);
    expect(moved([1, 2, 3, 4], 1, 2)).toEqual([2, 3, 1, 4]);
  });

  it('clamps a place past the end to the last place', () => {
    expect(moved([1, 2, 3], 1, 99)).toEqual([2, 3, 1]);
  });
});

describe('sameOrder and sameSet', () => {
  it('compare lists by order or as sets', () => {
    expect(sameOrder([1, 2], [1, 2])).toBe(true);
    expect(sameOrder([1, 2], [2, 1])).toBe(false);
    expect(sameSet(['actor', 'writer'], ['writer', 'actor'])).toBe(true);
    expect(sameSet(['actor'], ['actor', 'writer'])).toBe(false);
  });
});
