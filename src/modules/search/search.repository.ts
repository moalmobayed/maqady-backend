import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../../common/database/transaction-context';
import { PUBLIC_MOVIE_STATUSES } from '../catalog/enums';
import { anyMatchSql, bindingsOf, matchSql, scoreSql } from './search-terms';
import type {
  BookingHitRow,
  CatalogAudience,
  CustomerHitRow,
  MovieHitRow,
  PersonHitRow,
  SearchColumn,
  SearchTerms,
  TheaterHitRow,
} from './types';

const MOVIE_TITLE: SearchColumn = { sql: 'm.title', kind: 'name' };
const PERSON_NAME: SearchColumn = { sql: 'p.full_name', kind: 'name' };
const THEATER_COLUMNS: readonly SearchColumn[] = [
  { sql: 't.name::text', kind: 'name' },
  { sql: 't.district', kind: 'name' },
];
const CUSTOMER_COLUMNS: readonly SearchColumn[] = [
  { sql: 'c.full_name', kind: 'name' },
  { sql: 'c.email::text', kind: 'text' },
  { sql: 'c.phone', kind: 'phone' },
];
const BOOKING_COLUMNS: readonly SearchColumn[] = [
  { sql: 'b.contact_name', kind: 'name' },
  { sql: 'b.contact_email::text', kind: 'text' },
  { sql: 'b.contact_phone', kind: 'phone' },
];

/** The movie statuses customers see (design §11), as an SQL list of constants. */
const PUBLIC_STATUSES_SQL = PUBLIC_MOVIE_STATUSES.map((status) => `'${status}'`).join(', ');

/** A movie (`alias`) the audience may see: public ones for the customer site, any for admins. */
function visibleMovie(alias: string, audience: CatalogAudience): string {
  return audience === 'public' ? `${alias}.status IN (${PUBLIC_STATUSES_SQL})` : 'TRUE';
}

/**
 * The ranked queries of the public and staff search (design §5, §13.2): one query per group, at
 * most `limit` rows, best first. A read-only module, like `analytics`: it reads the catalog,
 * theater, customer and booking tables in its own queries and writes nothing. Every value is a
 * named binding; aliases and columns are code constants. The trigram GIN indexes (0070, 0150,
 * 0160, 0190) serve both the substring (`ILIKE`) and the typo-tolerant (`<%`) matches.
 */
@Injectable()
export class SearchRepository {
  constructor(private readonly db: TransactionContext) {}

  /**
   * Movies by title (`idx_movies_title_trgm`) or by a credited person's name
   * (`idx_people_full_name_trgm`, then `idx_movie_credits_person_id_movie_id`), each movie once
   * with its best match: a title match before a cast match of the same tier.
   */
  async movies(
    terms: SearchTerms,
    audience: CatalogAudience,
    limit: number,
  ): Promise<MovieHitRow[]> {
    const visible = visibleMovie('m', audience);
    const { rows } = await this.db.executor().raw<{ rows: MovieHitRow[] }>(
      `WITH hits AS (
         SELECT m.id AS movie_id, NULL::bigint AS person_id, NULL::text AS person_name,
                (${scoreSql([MOVIE_TITLE], terms)}) * 2 AS score,
                word_similarity(:q, m.title) AS similarity
         FROM movies AS m
         WHERE ${visible} AND ${matchSql(MOVIE_TITLE, terms)}
         UNION ALL
         SELECT c.movie_id, p.id, p.full_name::text,
                (${scoreSql([PERSON_NAME], terms)}) * 2 + 1,
                word_similarity(:q, p.full_name)
         FROM people AS p
         JOIN movie_credits AS c ON c.person_id = p.id
         JOIN movies AS m ON m.id = c.movie_id
         WHERE ${visible} AND ${matchSql(PERSON_NAME, terms)}
       ), best AS (
         SELECT DISTINCT ON (movie_id) movie_id, person_id, person_name, score, similarity
         FROM hits
         ORDER BY movie_id, score, similarity DESC, person_id NULLS FIRST
       )
       SELECT m.id, m.title, m.status, m.release_date, m.runtime_minutes, m.age_rating,
              m.poster_image_id, b.person_id AS matched_person_id,
              b.person_name AS matched_person_name
       FROM best AS b
       JOIN movies AS m ON m.id = b.movie_id
       ORDER BY b.score, b.similarity DESC, similarity(:q, m.title) DESC, m.title, m.id
       LIMIT :limit`,
      bindingsOf(terms, limit),
    );
    return rows;
  }

  /**
   * People by name (`idx_people_full_name_trgm`) with their roles. Publicly only people credited
   * on a public movie (as `GET /people`), and only those credits' roles.
   */
  async people(
    terms: SearchTerms,
    audience: CatalogAudience,
    limit: number,
  ): Promise<PersonHitRow[]> {
    const onVisibleMovie = `EXISTS (SELECT 1 FROM movies AS m WHERE m.id = c.movie_id AND ${visibleMovie('m', audience)})`;
    const credited = audience === 'public' ? `AND ${onVisibleMovie}` : '';
    const listed =
      audience === 'public'
        ? `AND EXISTS (SELECT 1 FROM movie_credits AS c WHERE c.person_id = p.id AND ${onVisibleMovie})`
        : '';
    const { rows } = await this.db.executor().raw<{ rows: PersonHitRow[] }>(
      `SELECT p.id, p.full_name, p.photo_image_id,
              ARRAY(SELECT r.role FROM person_roles AS r WHERE r.person_id = p.id
                    UNION
                    SELECT c.role FROM movie_credits AS c WHERE c.person_id = p.id ${credited}
              ) AS roles,
              ${scoreSql([PERSON_NAME], terms)} AS score
       FROM people AS p
       WHERE ${matchSql(PERSON_NAME, terms)} ${listed}
       ORDER BY score, word_similarity(:q, p.full_name) DESC, similarity(:q, p.full_name) DESC,
                p.full_name, p.id
       LIMIT :limit`,
      bindingsOf(terms, limit),
    );
    return rows;
  }

  /**
   * Theaters by name (`idx_theaters_name_trgm`) or district (`idx_theaters_district_trgm`).
   * Publicly only `active` theaters, as `GET /theaters`.
   */
  async theaters(
    terms: SearchTerms,
    audience: CatalogAudience,
    limit: number,
  ): Promise<TheaterHitRow[]> {
    const visible = audience === 'public' ? "t.status = 'active' AND" : '';
    const matched = anyMatchSql(THEATER_COLUMNS, terms);
    const { rows } = await this.db.executor().raw<{ rows: TheaterHitRow[] }>(
      `SELECT t.id, t.name, t.status, t.district, t.city, t.cover_image_id,
              ${scoreSql(THEATER_COLUMNS, terms)} AS score
       FROM theaters AS t
       WHERE ${visible} ${matched}
       ORDER BY score, word_similarity(:q, t.name::text) DESC, t.name, t.id
       LIMIT :limit`,
      bindingsOf(terms, limit),
    );
    return rows;
  }

  /**
   * Live customers by name, email or phone (`idx_customers_full_name_trgm`, `_email_trgm`,
   * `_phone_trgm`); an anonymised row (`deleted_at` set, no name, email or phone) never.
   */
  async customers(terms: SearchTerms, limit: number): Promise<CustomerHitRow[]> {
    const matched = anyMatchSql(CUSTOMER_COLUMNS, terms);
    const { rows } = await this.db.executor().raw<{ rows: CustomerHitRow[] }>(
      `SELECT c.id, c.full_name, c.email, c.phone, c.status, c.email_verified_at, c.created_at,
              ${scoreSql(CUSTOMER_COLUMNS, terms)} AS score
       FROM customers AS c
       WHERE c.deleted_at IS NULL AND ${matched}
       ORDER BY score, word_similarity(:q, c.full_name) DESC NULLS LAST, c.created_at DESC, c.id DESC
       LIMIT :limit`,
      bindingsOf(terms, limit),
    );
    return rows;
  }

  /**
   * Bookings: a whole reference finds that one (`uq_bookings_reference`); anything else matches
   * the contact name, email or phone (`idx_bookings_contact_*_trgm`), newest first within a
   * rank. Anonymisation cleared the contact of a deleted customer's bookings, so their old
   * details match none of them.
   */
  async bookings(terms: SearchTerms, limit: number): Promise<BookingHitRow[]> {
    if (terms.reference !== null) {
      return this.db
        .executor()('bookings')
        .select<BookingHitRow[]>('id')
        .where({ reference: terms.reference });
    }
    const matched = anyMatchSql(BOOKING_COLUMNS, terms);
    const { rows } = await this.db.executor().raw<{ rows: BookingHitRow[] }>(
      `SELECT b.id, ${scoreSql(BOOKING_COLUMNS, terms)} AS score
       FROM bookings AS b
       WHERE ${matched}
       ORDER BY score, word_similarity(:q, b.contact_name) DESC NULLS LAST, b.created_at DESC,
                b.id DESC
       LIMIT :limit`,
      bindingsOf(terms, limit),
    );
    return rows;
  }
}
