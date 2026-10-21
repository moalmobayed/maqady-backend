import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U4b (#5): weekly opening hours, one row per ISO weekday of the cinema date (1 = Monday …
 * 7 = Sunday), design §6.2 and §8. Minutes count from midnight at the start of the cinema date, so
 * a theater opens between 06:00 (360) and 23:59 and closes after it opens and at the latest at
 * 06:00 the next day (1800). The CHECK is the same as on `theater_special_dates`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE theater_hours (
      theater_id BIGINT NOT NULL,
      weekday SMALLINT NOT NULL,
      is_closed BOOLEAN NOT NULL,
      opens_minute SMALLINT NULL,
      closes_minute SMALLINT NULL,
      CONSTRAINT pk_theater_hours PRIMARY KEY (theater_id, weekday),
      CONSTRAINT fk_theater_hours_theater_id
        FOREIGN KEY (theater_id) REFERENCES theaters (id) ON DELETE CASCADE,
      CONSTRAINT chk_theater_hours_weekday CHECK (weekday BETWEEN 1 AND 7),
      CONSTRAINT chk_theater_hours_minutes CHECK (
        (is_closed AND opens_minute IS NULL AND closes_minute IS NULL)
        OR (NOT is_closed AND opens_minute >= 360 AND opens_minute < 1440
            AND opens_minute < closes_minute AND closes_minute <= 1800)
      )
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE theater_hours IS
      'Weekly opening hours by cinema-date weekday, in minutes from the start of the cinema date (design 6.2, 8).'
  `);
  await knex.raw(`
    COMMENT ON INDEX pk_theater_hours IS
      'Weekly hours of theaters: WHERE theater_id IN (...); the upsert of PUT hours ON CONFLICT (theater_id, weekday). Covers fk_theater_hours_theater_id.'
  `);
  await knex.raw('ALTER TABLE theater_hours ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.theater_hours', [schema]);
}
