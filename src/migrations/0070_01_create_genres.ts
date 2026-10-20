import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U6 (#7): the fixed genre list (design §6.2), seeded here with a stable URL slug (home-page
 * contract `GenreRef`). No route edits genres; a new genre is a new migration.
 */
const GENRES: readonly (readonly [string, string])[] = [
  ['Action', 'action'],
  ['Adventure', 'adventure'],
  ['Animation', 'animation'],
  ['Comedy', 'comedy'],
  ['Drama', 'drama'],
  ['Family', 'family'],
  ['Mystery', 'mystery'],
  ['Romance', 'romance'],
  ['Sci-fi', 'sci-fi'],
  ['Thriller', 'thriller'],
];

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE genres (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(40) NOT NULL,
      slug VARCHAR(40) NOT NULL,
      CONSTRAINT chk_genres_name CHECK (btrim(name) = name AND length(name) >= 1),
      CONSTRAINT chk_genres_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
      CONSTRAINT uq_genres_name UNIQUE (name),
      CONSTRAINT uq_genres_slug UNIQUE (slug)
    )
  `);
  await knex.raw(
    "COMMENT ON TABLE genres IS 'The fixed genre list, seeded by migration 0070_01 (design 6.2).'",
  );
  await knex.raw(
    "COMMENT ON INDEX uq_genres_name IS 'Genres alphabetical: ORDER BY name (admin editor, public genre lists). Also keeps names unique.'",
  );
  await knex.raw(
    "COMMENT ON INDEX uq_genres_slug IS 'Public genre filters by slug: WHERE slug IN (...), for example ?genres=sci-fi.'",
  );
  await knex('genres').insert(GENRES.map(([name, slug]) => ({ name, slug })));
  await knex.raw('ALTER TABLE genres ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.genres', [schema]);
}
