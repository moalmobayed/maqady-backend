import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U10 (#11): who holds each seat of a showtime right now (design §6.2, §6.3, §7.2).
 *
 * - The primary key (`showtime_id`, `seat_label`) is the guarantee that a seat belongs to at most
 *   one booking: every claim is one `INSERT … ON CONFLICT … DO UPDATE` that takes a row over
 *   only when its claim has ended, so two concurrent holds serialize on the row lock.
 * - `claimed_until` is when the claim ends: the hold's expiry for a hold, NULL for a sold seat.
 *   A row whose `claimed_until <= now` is free (an expired or released hold), judged at read and
 *   write time from the service's `Clock`, never by a job.
 * - The composite foreign key keeps a claim on its own booking's showtime.
 * - No defaults; rows are written only by the claim statement (U10), confirmation (U11) and
 *   refunds and edits (U14).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE seat_claims (
      showtime_id BIGINT NOT NULL,
      seat_label VARCHAR(3) NOT NULL,
      booking_id BIGINT NOT NULL,
      claimed_until TIMESTAMPTZ NULL,
      CONSTRAINT pk_seat_claims PRIMARY KEY (showtime_id, seat_label),
      CONSTRAINT fk_seat_claims_booking_id_showtime_id
        FOREIGN KEY (booking_id, showtime_id) REFERENCES bookings (id, showtime_id),
      CONSTRAINT chk_seat_claims_seat_label
        CHECK (seat_label ~ '^[A-HJ-P]([1-9]|1[0-9]|20)$')
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE seat_claims IS
      'One row per claimed seat of a showtime: claimed_until NULL is sold, <= now is free (design 7.2).'
  `);
  await knex.raw(`
    COMMENT ON COLUMN seat_claims.claimed_until IS
      'When the claim ends: the hold expiry, or NULL for a sold seat. A row with claimed_until <= now is free.'
  `);
  await knex.raw(
    'CREATE INDEX idx_seat_claims_booking_id_showtime_id ON seat_claims (booking_id, showtime_id)',
  );
  const comments: [name: string, comment: string][] = [
    [
      'pk_seat_claims',
      "The claim upsert's conflict target: ON CONFLICT (showtime_id, seat_label). A showtime's snapshot: WHERE showtime_id = ? AND (claimed_until IS NULL OR claimed_until > ?); taken counts and live-claim checks: WHERE showtime_id = ANY(?) AND (claimed_until IS NULL OR claimed_until > ?).",
    ],
    [
      'idx_seat_claims_booking_id_showtime_id',
      "Covers fk_seat_claims_booking_id_showtime_id. A booking's claims: WHERE booking_id = ? (confirmation, refunds and edits).",
    ],
  ];
  for (const [name, comment] of comments) {
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
  await knex.raw('ALTER TABLE seat_claims ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.seat_claims', [schema]);
}
