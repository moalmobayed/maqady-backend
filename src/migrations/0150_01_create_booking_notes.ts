import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U14 (#15): internal staff notes on a booking (design §6.2 `booking_notes`; PRD A6 "internal
 * notes"). Staff only: no customer route ever reads this table, and the text never enters the
 * audit log (the `booking.note_added` event carries no body).
 *
 * - `body` is 1 to 1,000 characters, never only spaces (the API trims it first).
 * - Notes are never edited. Anonymising a customer (U15, design §21) deletes the notes on their
 *   bookings; bookings themselves are never deleted, so neither foreign key has an `ON DELETE`.
 * - No defaults: `created_at` comes from the service's `Clock`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE booking_notes (
      id BIGSERIAL PRIMARY KEY,
      booking_id BIGINT NOT NULL,
      staff_user_id BIGINT NOT NULL,
      body VARCHAR(1000) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT fk_booking_notes_booking_id FOREIGN KEY (booking_id) REFERENCES bookings (id),
      CONSTRAINT fk_booking_notes_staff_user_id
        FOREIGN KEY (staff_user_id) REFERENCES staff_users (id),
      CONSTRAINT chk_booking_notes_body CHECK (btrim(body) <> '')
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE booking_notes IS
      'Internal staff notes on bookings; never shown to customers (design 6.2, PRD A6).'
  `);
  const indexes: [name: string, definition: string, comment: string][] = [
    [
      'idx_booking_notes_booking_id_created_at',
      'ON booking_notes (booking_id, created_at, id)',
      "Covers fk_booking_notes_booking_id. A booking's notes, newest first: WHERE booking_id = ? ORDER BY created_at DESC, id DESC with the keyset (GET /admin/bookings/{ref}/notes); WHERE booking_id = ANY(?) (anonymisation, U15).",
    ],
    [
      'idx_booking_notes_staff_user_id',
      'ON booking_notes (staff_user_id)',
      'Covers fk_booking_notes_staff_user_id: WHERE staff_user_id = ? (the notes a staff member wrote).',
    ],
  ];
  for (const [name, definition, comment] of indexes) {
    await knex.raw(`CREATE INDEX ${name} ${definition}`);
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
  await knex.raw('ALTER TABLE booking_notes ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.booking_notes', [schema]);
}
