import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U4b (#5): a theater's facilities (design §6.2, PRD A4), one row per facility. The list mirrors
 * `FACILITIES` in `src/modules/theaters/enums.ts`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE theater_facilities (
      theater_id BIGINT NOT NULL,
      facility VARCHAR(32) NOT NULL,
      CONSTRAINT pk_theater_facilities PRIMARY KEY (theater_id, facility),
      CONSTRAINT fk_theater_facilities_theater_id
        FOREIGN KEY (theater_id) REFERENCES theaters (id) ON DELETE CASCADE,
      CONSTRAINT chk_theater_facilities_facility CHECK (facility IN (
        'wheelchair_access', 'free_parking', 'valet_parking', 'street_parking', 'cafe_bar',
        'food_court', 'kids_room'
      ))
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE theater_facilities IS 'Facilities of a theater (design 6.2).'
  `);
  await knex.raw(`
    COMMENT ON INDEX pk_theater_facilities IS
      'Facilities of theaters: WHERE theater_id IN (...). Covers fk_theater_facilities_theater_id.'
  `);
  await knex.raw('ALTER TABLE theater_facilities ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.theater_facilities', [schema]);
}
