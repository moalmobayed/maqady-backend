import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * #29 P4: a hall's projection format and screen size (API Data Gaps Report items 7, 10 and 12;
 * docs/gh-29-hall-screen-format). The format is a label customers see on the theater page halls
 * and on every showtime chip ("Atmos"); it never changes a price (zone prices stay the only
 * prices). The screen is stored in whole centimetres, both sides or neither.
 *
 * Expand only: the previous release inserts halls naming its columns and never `format`, so the
 * column keeps `DEFAULT 'standard'` while that release may run beside this one (design §6.1);
 * the default also gives every existing hall `standard`, which is what it is. This release
 * always writes the format itself. Nothing filters or sorts by these columns: no index.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE halls
      ADD COLUMN format VARCHAR(16) NOT NULL DEFAULT 'standard',
      ADD COLUMN screen_width_cm INT NULL,
      ADD COLUMN screen_height_cm INT NULL,
      ADD CONSTRAINT chk_halls_format
        CHECK (format IN ('standard', 'vip', 'imax', 'dolby_atmos', '4dx', 'screenx', 'max')),
      ADD CONSTRAINT chk_halls_screen_size
        CHECK ((screen_width_cm IS NULL) = (screen_height_cm IS NULL)),
      ADD CONSTRAINT chk_halls_screen_width_cm CHECK (screen_width_cm BETWEEN 100 AND 5000),
      ADD CONSTRAINT chk_halls_screen_height_cm CHECK (screen_height_cm BETWEEN 100 AND 5000)
  `);
  await knex.raw(`
    COMMENT ON COLUMN halls.format IS
      'Projection format shown on the hall and its showtime chips (HALL_FORMATS in halls/enums.ts); a label, never a price.'
  `);
  await knex.raw(`
    COMMENT ON COLUMN halls.screen_width_cm IS
      'Screen width in whole centimetres (1 m to 50 m), set with screen_height_cm; NULL when unknown.'
  `);
  await knex.raw(`
    COMMENT ON COLUMN halls.screen_height_cm IS
      'Screen height in whole centimetres (1 m to 50 m), set with screen_width_cm; NULL when unknown.'
  `);
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw(
    `ALTER TABLE ??.halls
       DROP COLUMN IF EXISTS screen_height_cm,
       DROP COLUMN IF EXISTS screen_width_cm,
       DROP COLUMN IF EXISTS format`,
    [schema],
  );
}
