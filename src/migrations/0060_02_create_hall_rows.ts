import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U5 (#6): one row per hall row, front to back, with its zone (design §6.2; PRD "Halls and seat
 * maps" 1–2, "Prices" 1). `row_index` 0 is the row nearest the screen; its label is the letter at
 * that index of `ABCDEFGHJKLMNOP` (A to P without I), checked here so the pair never drifts. A
 * hall has rows for exactly its `row_count` indexes: the layout service replaces them together in
 * one transaction.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE hall_rows (
      hall_id BIGINT NOT NULL,
      row_index SMALLINT NOT NULL,
      row_label VARCHAR(1) NOT NULL,
      zone VARCHAR(8) NOT NULL,
      CONSTRAINT pk_hall_rows PRIMARY KEY (hall_id, row_index),
      CONSTRAINT fk_hall_rows_hall_id
        FOREIGN KEY (hall_id) REFERENCES halls (id) ON DELETE CASCADE,
      CONSTRAINT uq_hall_rows_hall_id_row_label UNIQUE (hall_id, row_label),
      CONSTRAINT chk_hall_rows_row_index CHECK (row_index BETWEEN 0 AND 14),
      CONSTRAINT chk_hall_rows_row_label
        CHECK (row_label = substr('ABCDEFGHJKLMNOP', row_index + 1, 1)),
      CONSTRAINT chk_hall_rows_zone CHECK (zone IN ('front', 'middle', 'back'))
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE hall_rows IS
      'The rows of a hall, front to back, each with its seat zone (design 6.2, 9).'
  `);

  const comments: [string, string][] = [
    [
      'pk_hall_rows',
      'Covers fk_hall_rows_hall_id. Rows of halls: WHERE hall_id IN (...) ORDER BY hall_id, row_index; the layout replace: DELETE ... WHERE hall_id = ?.',
    ],
    [
      'uq_hall_rows_hall_id_row_label',
      'Target of fk_hall_seat_marks_hall_id_row_label, so a seat mark always sits in an existing row of its hall.',
    ],
  ];
  for (const [name, comment] of comments) {
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
  await knex.raw('ALTER TABLE hall_rows ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.hall_rows', [schema]);
}
