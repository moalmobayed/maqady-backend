import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

const FACILITIES_BEFORE = `'wheelchair_access', 'free_parking', 'valet_parking', 'street_parking', 'cafe_bar',
        'food_court', 'kids_room'`;

/**
 * #29 P3: a theater can list a prayer room (API Data Gaps Report items 5 and 11;
 * docs/gh-29-theater-fields). The facility CHECK of `0055_03` is replaced by one that also takes
 * `prayer_room`; the list mirrors `FACILITIES` in `src/modules/theaters/enums.ts`.
 *
 * Both statements run in this migration's transaction, so no write ever sees the table without
 * the CHECK. Widening only: the previous release never writes `prayer_room`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE theater_facilities DROP CONSTRAINT chk_theater_facilities_facility
  `);
  await knex.raw(`
    ALTER TABLE theater_facilities ADD CONSTRAINT chk_theater_facilities_facility
      CHECK (facility IN (
        ${FACILITIES_BEFORE}, 'prayer_room'
      ))
  `);
}

/** Removes the prayer rooms, then restores the CHECK of `0055_03`. */
export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw("DELETE FROM ??.theater_facilities WHERE facility = 'prayer_room'", [schema]);
  await knex.raw(
    'ALTER TABLE ??.theater_facilities DROP CONSTRAINT IF EXISTS chk_theater_facilities_facility',
    [schema],
  );
  await knex.raw(
    `ALTER TABLE ??.theater_facilities ADD CONSTRAINT chk_theater_facilities_facility
      CHECK (facility IN (
        ${FACILITIES_BEFORE}
      ))`,
    [schema],
  );
}
