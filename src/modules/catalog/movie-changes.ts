import type {
  MovieChanges,
  MovieRow,
  MovieRowDiff,
  PersonChanges,
  PersonRow,
  PersonRowDiff,
} from './types';

/** The API field of a movie edit and the column it writes. */
const MOVIE_FIELD_COLUMNS = [
  ['title', 'title'],
  ['synopsis', 'synopsis'],
  ['runtimeMinutes', 'runtime_minutes'],
  ['releaseDate', 'release_date'],
  ['ageRating', 'age_rating'],
  ['language', 'language'],
  ['country', 'country'],
  ['productionCompany', 'production_company'],
  ['budgetLabel', 'budget_label'],
  ['filmingLocations', 'filming_locations'],
  ['heroVideoId', 'hero_video_id'],
  ['backdropPhotoId', 'backdrop_photo_id'],
] as const satisfies readonly (readonly [keyof MovieChanges, keyof MovieRow])[];

const PERSON_FIELD_COLUMNS = [
  ['fullName', 'full_name'],
  ['birthDate', 'birth_date'],
  ['birthPlace', 'birth_place'],
  ['nationality', 'nationality'],
  ['bio', 'bio'],
  ['instagramUrl', 'instagram_url'],
  ['imdbUrl', 'imdb_url'],
  ['websiteUrl', 'website_url'],
] as const satisfies readonly (readonly [keyof PersonChanges, keyof PersonRow])[];

/**
 * The columns a movie edit changes (sent and different from the row), with the API names of
 * those fields. Genres, status and the featured position are judged by the service.
 */
export function diffMovie(row: MovieRow, changes: MovieChanges): MovieRowDiff {
  const columns: Record<string, unknown> = {};
  const changedFields: string[] = [];
  for (const [field, column] of MOVIE_FIELD_COLUMNS) {
    const value = changes[field];
    if (value === undefined || value === row[column]) continue;
    columns[column] = value;
    changedFields.push(field);
  }
  return { columns: columns, changedFields };
}

/** The columns a person edit changes, with the API names of those fields (roles excluded). */
export function diffPerson(row: PersonRow, changes: PersonChanges): PersonRowDiff {
  const columns: Record<string, unknown> = {};
  const changedFields: string[] = [];
  for (const [field, column] of PERSON_FIELD_COLUMNS) {
    const value = changes[field];
    if (value === undefined || value === row[column]) continue;
    columns[column] = value;
    changedFields.push(field);
  }
  return { columns: columns, changedFields };
}

/** True when two id lists hold the same ids in the same order. */
export function sameOrder(first: readonly unknown[], second: readonly unknown[]): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

/** True when two lists hold the same values, in any order. */
export function sameSet(first: readonly unknown[], second: readonly unknown[]): boolean {
  const set = new Set(first);
  return set.size === new Set(second).size && second.every((value) => set.has(value));
}

/** `items` with `item` moved to index `to`, clamped to the last place. */
export function moved<T>(items: readonly T[], item: T, to: number): T[] {
  const rest = items.filter((existing) => existing !== item);
  const target = Math.min(Math.max(to, 0), rest.length);
  return [...rest.slice(0, target), item, ...rest.slice(target)];
}
