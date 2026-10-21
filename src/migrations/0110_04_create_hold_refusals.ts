import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U10 (#11): hold requests refused because a seat was already taken (design §6.2, §7.2), for the
 * PRD's seat conflict rate (refused holds ÷ all hold requests, U17). The refused request rolls
 * back, so its row is written afterwards in a transaction of its own. No personal data: the
 * showtime, when, and how many seats were asked for.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE hold_refusals (
      id BIGSERIAL PRIMARY KEY,
      showtime_id BIGINT NOT NULL,
      refused_at TIMESTAMPTZ NOT NULL,
      seat_count SMALLINT NOT NULL,
      CONSTRAINT fk_hold_refusals_showtime_id FOREIGN KEY (showtime_id) REFERENCES showtimes (id),
      CONSTRAINT chk_hold_refusals_seat_count CHECK (seat_count BETWEEN 1 AND 8)
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE hold_refusals IS
      'Holds refused with SEAT_TAKEN, written after the refused request rolled back (design 6.2, 7.2).'
  `);
  await knex.raw(
    'CREATE INDEX idx_hold_refusals_showtime_id_refused_at ON hold_refusals (showtime_id, refused_at)',
  );
  await knex.raw(`
    COMMENT ON INDEX idx_hold_refusals_showtime_id_refused_at IS
      'Covers fk_hold_refusals_showtime_id. A showtime''s refusals in a period: WHERE showtime_id = ANY(?) AND refused_at >= ? AND refused_at < ? (the seat conflict rate, U17).'
  `);
  await knex.raw('ALTER TABLE hold_refusals ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.hold_refusals', [schema]);
}
