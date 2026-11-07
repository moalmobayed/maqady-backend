import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U18 (#19): the indexes of the public and staff search (design §13.2; PRD "Search"). Indexes and
 * comments only, so the previous release runs beside them (design §6.1).
 *
 * - Both searches match a case-insensitive substring (`ILIKE '%…%'`) or, on names and titles, a
 *   typo-tolerant word similarity (`? <% column`, pg_trgm). Trigram GIN indexes serve both
 *   operators (pg_trgm, created by 0010_01).
 * - Theater names and districts get theirs here. `name` is CITEXT, which `gin_trgm_ops` does not
 *   take, so its index and its queries cast it to text.
 * - The movie, people, customer and booking-contact trigram indexes exist (0070, 0150, 0160);
 *   their comments are rewritten to name the search queries that now use them too. `down`
 *   restores the comments they had.
 */
const INDEXES: [name: string, definition: string, comment: string][] = [
  [
    'idx_theaters_name_trgm',
    'CREATE INDEX idx_theaters_name_trgm ON theaters USING gin ((name::text) gin_trgm_ops)',
    'Theater search by name: WHERE name::text ILIKE ? OR ? <% name::text (a substring or a typo-tolerant match; GET /search, active theaters only, and GET /admin/search).',
  ],
  [
    'idx_theaters_district_trgm',
    'CREATE INDEX idx_theaters_district_trgm ON theaters USING gin (district gin_trgm_ops)',
    'Theater search by area: WHERE district ILIKE ? OR ? <% district (a substring or a typo-tolerant match; GET /search, active theaters only, and GET /admin/search).',
  ],
];

/** Existing search indexes: [name, the comment U18 gives them, the comment they had before]. */
const RECOMMENTED: [name: string, comment: string, previous: string][] = [
  [
    'idx_movies_title_trgm',
    'Title search: WHERE title ILIKE ? (admin q, U8 movie lists), and WHERE title ILIKE ? OR ? <% title (a substring or a typo-tolerant match; GET /search on public movies, GET /admin/search on every movie).',
    'Title search: WHERE title ILIKE ? (admin q, U8 and U18 search), a case-insensitive substring match.',
  ],
  [
    'idx_people_full_name_trgm',
    'Name search: WHERE full_name ILIKE ? (admin people q, cast search in movie lists), and WHERE full_name ILIKE ? OR ? <% full_name (people and the cast of movies in GET /search and GET /admin/search).',
    'Name search: WHERE full_name ILIKE ? (admin people q, cast search in movie lists, U18).',
  ],
  [
    'idx_customers_full_name_trgm',
    'Customer name search: WHERE full_name ILIKE ? (GET /admin/customers?q=), and WHERE full_name ILIKE ? OR ? <% full_name (a substring or a typo-tolerant match; GET /admin/search).',
    'Admin customers search: WHERE full_name ILIKE ? (a substring, any case; GET /admin/customers?q=, U18 search).',
  ],
  [
    'idx_customers_email_trgm',
    'Customer email search: WHERE email::text ILIKE ? (a substring, any case; GET /admin/customers?q= and GET /admin/search).',
    'Admin customers search: WHERE email::text ILIKE ? (a substring, any case; GET /admin/customers?q=, U18 search).',
  ],
  [
    'idx_customers_phone_trgm',
    'Customer phone search: WHERE phone ILIKE ? (digits typed anywhere in the number; GET /admin/customers?q= and GET /admin/search).',
    'Admin customers search: WHERE phone ILIKE ? (digits typed anywhere in the number; GET /admin/customers?q=, U18 search).',
  ],
  [
    'idx_bookings_contact_name_trgm',
    'Booking contact name search: WHERE contact_name ILIKE ? (GET /admin/bookings?q=), and WHERE contact_name ILIKE ? OR ? <% contact_name (a substring or a typo-tolerant match; GET /admin/search).',
    'Admin bookings search: WHERE contact_name ILIKE ? (a substring, any case; GET /admin/bookings?q=, U18 search).',
  ],
  [
    'idx_bookings_contact_email_trgm',
    'Booking contact email search: WHERE contact_email::text ILIKE ? (a substring, any case; GET /admin/bookings?q= and GET /admin/search).',
    'Admin bookings search: WHERE contact_email::text ILIKE ? (a substring, any case; GET /admin/bookings?q=, U18 search).',
  ],
  [
    'idx_bookings_contact_phone_trgm',
    'Booking contact phone search: WHERE contact_phone ILIKE ? (digits typed anywhere in the number; GET /admin/bookings?q= and GET /admin/search).',
    'Admin bookings search: WHERE contact_phone ILIKE ? (digits typed anywhere in the number; GET /admin/bookings?q=, U18 search).',
  ],
];

// COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
async function comment(knex: Knex, name: string, text: string): Promise<void> {
  await knex.raw(`COMMENT ON INDEX ${name} IS '${text.replace(/'/g, "''")}'`);
}

export async function up(knex: Knex): Promise<void> {
  for (const [name, definition, text] of INDEXES) {
    await knex.raw(definition);
    await comment(knex, name, text);
  }
  for (const [name, text] of RECOMMENTED) await comment(knex, name, text);
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  for (const [name, , previous] of RECOMMENTED) await comment(knex, name, previous);
  for (const [name] of [...INDEXES].reverse()) {
    await knex.raw('DROP INDEX IF EXISTS ??.??', [schema, name]);
  }
}
