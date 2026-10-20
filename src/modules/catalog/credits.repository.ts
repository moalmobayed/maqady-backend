import { Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { TransactionContext } from '../../common/database/transaction-context';
import type {
  CharacterNameChange,
  KnownForRow,
  MovieCreditCountRow,
  MovieCreditRow,
  MovieCreditWithPersonRow,
  NewMovieCreditRow,
  PersonCreditSummaryRow,
  PersonCreditWithMovieRow,
} from './types';

const CREDIT_COLUMNS = [
  'c.id',
  'c.movie_id',
  'c.person_id',
  'c.role',
  'c.character_name',
  'c.sort_order',
] as const;

/** `movie_credits` (design §6.2): cast and crew, in each movie's display order. */
@Injectable()
export class CreditsRepository {
  constructor(private readonly db: TransactionContext) {}

  /** The credits of these movies with their people, by movie then display order. */
  async creditsOfMovies(movieIds: readonly number[]): Promise<MovieCreditWithPersonRow[]> {
    if (movieIds.length === 0) return [];
    return this.credits()
      .join('people as p', 'p.id', 'c.person_id')
      .select<MovieCreditWithPersonRow[]>(...CREDIT_COLUMNS, 'p.full_name', 'p.photo_image_id')
      .whereIn('c.movie_id', [...movieIds])
      .orderBy([
        { column: 'c.movie_id', order: 'asc' },
        { column: 'c.sort_order', order: 'asc' },
        { column: 'c.id', order: 'asc' },
      ]);
  }

  /**
   * The credits of these people with their movies: newest release first, undated last, then
   * title and id.
   */
  async creditsOfPeople(personIds: readonly number[]): Promise<PersonCreditWithMovieRow[]> {
    if (personIds.length === 0) return [];
    return this.credits()
      .join('movies as m', 'm.id', 'c.movie_id')
      .select<PersonCreditWithMovieRow[]>(
        ...CREDIT_COLUMNS,
        'm.title',
        'm.status',
        'm.release_date',
        'm.poster_image_id',
      )
      .whereIn('c.person_id', [...personIds])
      .orderByRaw('c.person_id, m.release_date DESC NULLS LAST, m.title, m.id, c.sort_order, c.id');
  }

  /** The plain credit rows of one person. */
  async ofPerson(personId: number): Promise<MovieCreditRow[]> {
    return this.credits()
      .select<MovieCreditRow[]>(...CREDIT_COLUMNS)
      .where('c.person_id', personId)
      .orderBy('c.id');
  }

  /** The movies a person is credited on, ascending. */
  async movieIdsOfPerson(personId: number): Promise<number[]> {
    const rows = await this.db
      .executor()('movie_credits')
      .distinct<{ movie_id: number }[]>('movie_id')
      .where({ person_id: personId })
      .orderBy('movie_id');
    return rows.map((row) => row.movie_id);
  }

  /** Replaces a movie's credits with these rows. */
  async replaceForMovie(movieId: number, rows: readonly NewMovieCreditRow[]): Promise<void> {
    await this.db.executor()('movie_credits').where({ movie_id: movieId }).delete();
    await this.insertMany(rows);
  }

  async insertMany(rows: readonly NewMovieCreditRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .executor()('movie_credits')
      .insert([...rows]);
  }

  async deleteByIds(ids: readonly number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .executor()('movie_credits')
      .whereIn('id', [...ids])
      .delete();
  }

  /** Sets the character names of these credits, in one statement. */
  async setCharacterNames(changes: readonly CharacterNameChange[]): Promise<void> {
    if (changes.length === 0) return;
    await this.db.executor().raw(
      `UPDATE movie_credits AS c SET character_name = v.character_name
       FROM unnest(?::bigint[], ?::text[]) AS v(id, character_name)
       WHERE c.id = v.id AND c.character_name IS DISTINCT FROM v.character_name`,
      [
        changes.map((change) => change.id),
        // node-pg sends null elements as SQL NULL; Knex's types only allow string arrays.
        changes.map((change) => change.characterName) as unknown as string[],
      ],
    );
  }

  /** Renumbers each of these movies' credits `0…n-1` in their current order, in one statement. */
  async renumber(movieIds: readonly number[]): Promise<void> {
    if (movieIds.length === 0) return;
    await this.db.executor().raw(
      `UPDATE movie_credits AS c SET sort_order = r.position
       FROM (
         SELECT id, (row_number() OVER (PARTITION BY movie_id ORDER BY sort_order, id) - 1) AS position
         FROM movie_credits WHERE movie_id = ANY(?::bigint[])
       ) AS r
       WHERE c.id = r.id AND c.sort_order <> r.position`,
      [[...movieIds]],
    );
  }

  /** How many credits each of these movies has. */
  async countsByMovie(movieIds: readonly number[]): Promise<Map<number, number>> {
    if (movieIds.length === 0) return new Map();
    const rows = await this.db
      .executor()('movie_credits')
      .select<MovieCreditCountRow[]>('movie_id', this.db.executor().raw('count(*)::int AS count'))
      .whereIn('movie_id', [...movieIds])
      .groupBy('movie_id');
    return new Map(rows.map((row) => [row.movie_id, row.count]));
  }

  /** Each person's credit count and the distinct roles they are credited in. */
  async summariesOf(personIds: readonly number[]): Promise<PersonCreditSummaryRow[]> {
    if (personIds.length === 0) return [];
    return this.db
      .executor()('movie_credits')
      .select<PersonCreditSummaryRow[]>(
        'person_id',
        this.db.executor().raw('count(*)::int AS credit_count'),
        this.db.executor().raw('array_agg(DISTINCT role) AS roles'),
      )
      .whereIn('person_id', [...personIds])
      .groupBy('person_id');
  }

  /** Up to `limit` movies per person, newest release first (undated last), then title. */
  async knownFor(personIds: readonly number[], limit: number): Promise<KnownForRow[]> {
    if (personIds.length === 0) return [];
    const { rows } = await this.db.executor().raw<{ rows: KnownForRow[] }>(
      `SELECT person_id, movie_id, title FROM (
         SELECT d.person_id, d.movie_id, d.title,
           row_number() OVER (PARTITION BY d.person_id
             ORDER BY d.release_date DESC NULLS LAST, d.title, d.movie_id) AS rank
         FROM (
           SELECT DISTINCT c.person_id, m.id AS movie_id, m.title, m.release_date
           FROM movie_credits c JOIN movies m ON m.id = c.movie_id
           WHERE c.person_id = ANY(?::bigint[])
         ) AS d
       ) AS ranked
       WHERE rank <= ?
       ORDER BY person_id, rank`,
      [[...personIds], limit],
    );
    return rows;
  }

  private credits(): Knex.QueryBuilder {
    return this.db.executor()('movie_credits as c');
  }
}
