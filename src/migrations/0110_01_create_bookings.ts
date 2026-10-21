import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U10 (#11): bookings (design §6.2, §7.3, §7.4, §7.9). Every booking starts as a hold
 * (`status = 'held'`); the three other stored statuses arrive with checkout (U11) and refunds
 * (U14). Held, Failed and Abandoned are told apart at read time from `hold_expires_at` and
 * `has_declined_payment` (§7.4), so no job ever rewrites a row when a hold runs out.
 *
 * - `reference` (`MQ-` and 6 characters without 0, O, 1, I or L) is what every API path names;
 *   the insert uses `ON CONFLICT (reference) DO NOTHING`, so a collision never aborts the
 *   transaction (§7.9, §14.1).
 * - `hold_token_hash` is the SHA-256 of a guest's hold code. It exists only on an online,
 *   unowned hold, and claiming the hold clears it, so the code is useless from then on (§7.3).
 * - `uq_bookings_id_showtime_id` backs the composite foreign key from `seat_claims`, which keeps
 *   a claim on its booking's own showtime (§6.3).
 * - The checkout, refund and check-in columns (`confirmed_at`, `refunded_at`, `qr_version`,
 *   `checked_in_*`, `has_declined_payment`) exist now so U11 to U14 only fill them; their CHECKs
 *   already say which status each belongs to.
 * - No defaults: times come from the service's `Clock`, booleans are written by the service.
 *   Bookings are never deleted.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE bookings (
      id BIGSERIAL PRIMARY KEY,
      reference VARCHAR(9) NOT NULL,
      showtime_id BIGINT NOT NULL,
      status VARCHAR(16) NOT NULL,
      channel VARCHAR(16) NOT NULL,
      customer_id BIGINT NULL,
      created_by_staff_id BIGINT NULL,
      hold_token_hash VARCHAR(64) NULL,
      hold_expires_at TIMESTAMPTZ NOT NULL,
      has_declined_payment BOOLEAN NOT NULL,
      seat_count SMALLINT NOT NULL,
      total_amount INT NOT NULL,
      currency VARCHAR(3) NOT NULL,
      contact_name VARCHAR(100) NULL,
      contact_email CITEXT NULL,
      contact_phone VARCHAR(16) NULL,
      confirmed_at TIMESTAMPTZ NULL,
      refunded_at TIMESTAMPTZ NULL,
      qr_version SMALLINT NULL,
      checked_in_at TIMESTAMPTZ NULL,
      checked_in_by_staff_id BIGINT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT uq_bookings_reference UNIQUE (reference),
      CONSTRAINT uq_bookings_id_showtime_id UNIQUE (id, showtime_id),
      CONSTRAINT fk_bookings_showtime_id FOREIGN KEY (showtime_id) REFERENCES showtimes (id),
      CONSTRAINT fk_bookings_customer_id FOREIGN KEY (customer_id) REFERENCES customers (id),
      CONSTRAINT fk_bookings_created_by_staff_id
        FOREIGN KEY (created_by_staff_id) REFERENCES staff_users (id),
      CONSTRAINT fk_bookings_checked_in_by_staff_id
        FOREIGN KEY (checked_in_by_staff_id) REFERENCES staff_users (id),
      CONSTRAINT chk_bookings_reference CHECK (reference ~ '^MQ-[2-9A-HJKMNP-Z]{6}$'),
      CONSTRAINT chk_bookings_status CHECK (status IN ('held', 'confirmed', 'refunded')),
      CONSTRAINT chk_bookings_channel CHECK (channel IN ('online', 'counter')),
      CONSTRAINT chk_bookings_channel_staff
        CHECK ((channel = 'counter') = (created_by_staff_id IS NOT NULL)),
      CONSTRAINT chk_bookings_hold_token_hash CHECK (
        hold_token_hash IS NULL OR (
          hold_token_hash ~ '^[0-9a-f]{64}$'
          AND customer_id IS NULL AND channel = 'online' AND status = 'held'
        )
      ),
      CONSTRAINT chk_bookings_seat_count CHECK (seat_count BETWEEN 1 AND 8),
      CONSTRAINT chk_bookings_total_amount CHECK (total_amount > 0),
      CONSTRAINT chk_bookings_currency CHECK (currency IN ('EGP')),
      CONSTRAINT chk_bookings_contact_name CHECK (btrim(contact_name) <> ''),
      CONSTRAINT chk_bookings_contact_email
        CHECK (length(contact_email) <= 320 AND contact_email ~ '^[^\\s@]+@[^\\s@]+$'),
      CONSTRAINT chk_bookings_contact_phone CHECK (contact_phone ~ '^[+][1-9][0-9]{7,14}$'),
      CONSTRAINT chk_bookings_lifecycle CHECK (
        (status = 'held' AND confirmed_at IS NULL AND refunded_at IS NULL AND qr_version IS NULL)
        OR (status = 'confirmed' AND confirmed_at IS NOT NULL AND refunded_at IS NULL
            AND qr_version >= 1)
        OR (status = 'refunded' AND confirmed_at IS NOT NULL AND refunded_at IS NOT NULL
            AND qr_version >= 1)
      ),
      CONSTRAINT chk_bookings_check_in
        CHECK ((checked_in_at IS NULL) = (checked_in_by_staff_id IS NULL))
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE bookings IS
      'Holds and bookings: held, confirmed or refunded; Failed, Abandoned and Completed are decided at read time from stored times (design 6.2, 7.4).'
  `);

  const indexes: [name: string, definition: string, comment: string][] = [
    [
      'idx_bookings_showtime_id_status',
      'ON bookings (showtime_id, status)',
      "Covers fk_bookings_showtime_id. A showtime's bookings by status: WHERE showtime_id = ? AND status = ? (ticket holders of a moved showtime, a showtime's cancellation, the manage panel's sales).",
    ],
    [
      'idx_bookings_customer_id_status_hold_expires_at',
      'ON bookings (customer_id, status, hold_expires_at)',
      "Covers fk_bookings_customer_id. The customer's live hold: WHERE customer_id = ? AND status = 'held' AND hold_expires_at > ? (equality, equality, then range); a customer's bookings (My Bookings).",
    ],
    [
      'uq_bookings_hold_token_hash',
      'ON bookings (hold_token_hash) WHERE hold_token_hash IS NOT NULL',
      'The hold a guest code presents: WHERE hold_token_hash = ? (release on a re-pick, claim at sign-in). Unique, so a code names one hold.',
    ],
    [
      'idx_bookings_created_by_staff_id_status_hold_expires_at',
      'ON bookings (created_by_staff_id, status, hold_expires_at)',
      "Covers fk_bookings_created_by_staff_id. The staff member's live counter hold: WHERE created_by_staff_id = ? AND status = 'held' AND hold_expires_at > ? (U13).",
    ],
    [
      'idx_bookings_checked_in_by_staff_id',
      'ON bookings (checked_in_by_staff_id) WHERE checked_in_by_staff_id IS NOT NULL',
      'Covers fk_bookings_checked_in_by_staff_id: WHERE checked_in_by_staff_id = ? (scans by a staff member, U13).',
    ],
  ];
  for (const [name, definition, comment] of indexes) {
    const unique = name.startsWith('uq_') ? 'UNIQUE ' : '';
    await knex.raw(`CREATE ${unique}INDEX ${name} ${definition}`);
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
  const constraintComments: [name: string, comment: string][] = [
    ['uq_bookings_reference', 'Every /{ref} route: WHERE reference = ?. References never repeat.'],
    [
      'uq_bookings_id_showtime_id',
      'Target of fk_seat_claims_booking_id_showtime_id: a claim stays on its booking showtime.',
    ],
  ];
  for (const [name, comment] of constraintComments) {
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
  await knex.raw('ALTER TABLE bookings ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.bookings', [schema]);
}
