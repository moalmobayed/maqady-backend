import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U4b (#5): holiday hours (design §6.2, §8). A special date replaces the weekly hours of one
 * cinema date: other hours, or closed. Minutes follow `theater_hours`. At most one per theater
 * and cinema date. Past ones are kept until an admin deletes them; they change nothing.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE theater_special_dates (
      id BIGSERIAL PRIMARY KEY,
      theater_id BIGINT NOT NULL,
      cinema_date DATE NOT NULL,
      label VARCHAR(80) NOT NULL,
      is_closed BOOLEAN NOT NULL,
      opens_minute SMALLINT NULL,
      closes_minute SMALLINT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT fk_theater_special_dates_theater_id
        FOREIGN KEY (theater_id) REFERENCES theaters (id) ON DELETE CASCADE,
      CONSTRAINT uq_theater_special_dates_theater_id_cinema_date UNIQUE (theater_id, cinema_date),
      CONSTRAINT chk_theater_special_dates_label CHECK (length(label) >= 1 AND btrim(label) = label),
      CONSTRAINT chk_theater_special_dates_minutes CHECK (
        (is_closed AND opens_minute IS NULL AND closes_minute IS NULL)
        OR (NOT is_closed AND opens_minute >= 360 AND opens_minute < 1440
            AND opens_minute < closes_minute AND closes_minute <= 1800)
      )
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE theater_special_dates IS
      'Holiday hours: other hours, or closed, on one cinema date of a theater (design 6.2, 8).'
  `);
  await knex.raw(`
    COMMENT ON INDEX uq_theater_special_dates_theater_id_cinema_date IS
      'Special dates of theaters in a date range: WHERE theater_id IN (...) AND cinema_date BETWEEN ? AND ? (equality, then range). Covers fk_theater_special_dates_theater_id; one per theater and date.'
  `);
  await knex.raw('ALTER TABLE theater_special_dates ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.theater_special_dates', [schema]);
}
