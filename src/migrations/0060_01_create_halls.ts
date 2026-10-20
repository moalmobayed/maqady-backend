import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U5 (#6): halls (design §6.2, §9). A hall belongs to one theater, is a grid of `row_count` rows
 * (4 to 15) of `seats_per_row` seats (8 to 20), and is `draft`, `active` or `retired`. Its row
 * zones and seat marks live in `hall_rows` and `hall_seat_marks`. Only a hall that never had a
 * showtime is deleted, so rows are removed, never retracted: no `deleted_at`.
 *
 * `uq_halls_id_theater_id` is the target of U7's composite foreign key from `showtimes`, which
 * keeps a showtime's hall inside its theater (design §6.3).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE halls (
      id BIGSERIAL PRIMARY KEY,
      theater_id BIGINT NOT NULL,
      name CITEXT NOT NULL,
      status VARCHAR(16) NOT NULL,
      row_count SMALLINT NOT NULL,
      seats_per_row SMALLINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT fk_halls_theater_id
        FOREIGN KEY (theater_id) REFERENCES theaters (id) ON DELETE CASCADE,
      CONSTRAINT uq_halls_theater_id_name UNIQUE (theater_id, name),
      CONSTRAINT uq_halls_id_theater_id UNIQUE (id, theater_id),
      CONSTRAINT chk_halls_status CHECK (status IN ('draft', 'active', 'retired')),
      CONSTRAINT chk_halls_name CHECK (length(name) BETWEEN 1 AND 40 AND btrim(name) = name),
      CONSTRAINT chk_halls_row_count CHECK (row_count BETWEEN 4 AND 15),
      CONSTRAINT chk_halls_seats_per_row CHECK (seats_per_row BETWEEN 8 AND 20)
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE halls IS
      'Halls of a theater: name, status and the size of the seat grid (design 6.2, 9).'
  `);

  const comments: [string, string][] = [
    [
      'uq_halls_theater_id_name',
      "Covers fk_halls_theater_id. Admin hall list: WHERE theater_id = ? [AND status = ?] ORDER BY name, id with the cursor (name, id) > (?, ?); halls of theaters (U7, U8): WHERE theater_id IN (...); the active_hall publish check: WHERE theater_id = ? AND status = 'active'. Also keeps hall names unique per theater, case-insensitively.",
    ],
    [
      'uq_halls_id_theater_id',
      'Target of the composite foreign key showtimes (hall_id, theater_id) (U7, design 6.3).',
    ],
  ];
  for (const [name, comment] of comments) {
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
  await knex.raw('ALTER TABLE halls ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.halls', [schema]);
}
