import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U5 (#6): the exceptions to a hall's full grid (design §6.2; PRD "Halls and seat maps" 2): a
 * seat marked as a wheelchair space, or a cell with no seat (a gap). Seats are numbered 1 to
 * `seats_per_row` from the left, and a gap keeps its number. The foreign key puts every mark in
 * an existing row of its hall, and goes with that row; `seat_number <= seats_per_row` is the
 * layout service's rule, checked in the same transaction.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE hall_seat_marks (
      hall_id BIGINT NOT NULL,
      row_label VARCHAR(1) NOT NULL,
      seat_number SMALLINT NOT NULL,
      kind VARCHAR(16) NOT NULL,
      CONSTRAINT pk_hall_seat_marks PRIMARY KEY (hall_id, row_label, seat_number),
      CONSTRAINT fk_hall_seat_marks_hall_id_row_label
        FOREIGN KEY (hall_id, row_label) REFERENCES hall_rows (hall_id, row_label) ON DELETE CASCADE,
      CONSTRAINT chk_hall_seat_marks_seat_number CHECK (seat_number BETWEEN 1 AND 20),
      CONSTRAINT chk_hall_seat_marks_kind CHECK (kind IN ('wheelchair', 'no_seat'))
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE hall_seat_marks IS
      'Wheelchair spaces and gaps of a hall layout; every other cell of the grid is a seat (design 6.2, 9).'
  `);
  await knex.raw(`
    COMMENT ON INDEX pk_hall_seat_marks IS
      'Covers fk_hall_seat_marks_hall_id_row_label. Marks of halls: WHERE hall_id IN (...) ORDER BY hall_id, row_label, seat_number.'
  `);
  await knex.raw('ALTER TABLE hall_seat_marks ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.hall_seat_marks', [schema]);
}
