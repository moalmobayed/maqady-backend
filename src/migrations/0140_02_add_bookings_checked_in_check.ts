import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U13 (#14): only a paid booking is ever admitted at the entrance (design §7.9). A scan records
 * `checked_in_at` on a confirmed booking only; a booking admitted and later refunded (U14) keeps
 * its scan, so `refunded` stays allowed. A hold is never checked in.
 *
 * The scan's lookup paths use existing indexes: `uq_bookings_reference` (the QR payload and the
 * typed reference name the booking) and `idx_bookings_checked_in_by_staff_id` (covers the FK).
 * No booking was checked in before this unit, so no row can violate it.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE bookings
      ADD CONSTRAINT chk_bookings_checked_in_paid
      CHECK (checked_in_at IS NULL OR status IN ('confirmed', 'refunded'))
  `);
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('ALTER TABLE ??.bookings DROP CONSTRAINT IF EXISTS chk_bookings_checked_in_paid', [
    schema,
  ]);
}
