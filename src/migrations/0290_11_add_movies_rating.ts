import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * #29 P2: a movie's rating score (API Data Gaps Report item 14; docs/gh-29-movie-rating). An
 * admin types a score out of 10 with one decimal, from an outside source such as "elCinema
 * users", and customers see it on the movie page and its cards. Not Maqady's own ratings: no
 * votes, and nothing sorts or filters by it, so there is no index.
 *
 * Expand only: both columns are nullable without a default, and the previous release names
 * its columns and never writes these, so it runs beside this one (design §6.1).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE movies
      ADD COLUMN rating NUMERIC(3,1) NULL,
      ADD COLUMN rating_source VARCHAR(80) NULL,
      ADD CONSTRAINT chk_movies_rating CHECK (rating BETWEEN 0 AND 10),
      ADD CONSTRAINT chk_movies_rating_source
        CHECK (btrim(rating_source) = rating_source AND length(rating_source) >= 1),
      ADD CONSTRAINT chk_movies_rating_source_needs_rating
        CHECK (rating_source IS NULL OR rating IS NOT NULL)
  `);
  await knex.raw(`
    COMMENT ON COLUMN movies.rating IS
      'The score out of 10, one decimal (8.4), typed by an admin from an outside source; NULL when the movie has none.'
  `);
  await knex.raw(`
    COMMENT ON COLUMN movies.rating_source IS
      'Where the score comes from, shown under it (for example elCinema users); NULL shows the score alone. Needs a rating.'
  `);
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw(
    'ALTER TABLE ??.movies DROP COLUMN IF EXISTS rating_source, DROP COLUMN IF EXISTS rating',
    [schema],
  );
}
