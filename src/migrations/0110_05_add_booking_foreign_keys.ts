import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U10 (#11): the tables that name a booking now point at `bookings` (design §6.2). Each column
 * already has its covering index: `idx_audit_events_booking_id` (U1) and
 * `idx_messages_related_booking_id` (U3). No `ON DELETE`: bookings are never deleted.
 */
const FOREIGN_KEYS: readonly (readonly [table: string, constraint: string, column: string])[] = [
  ['audit_events', 'fk_audit_events_booking_id', 'booking_id'],
  ['messages', 'fk_messages_related_booking_id', 'related_booking_id'],
];

export async function up(knex: Knex): Promise<void> {
  for (const [table, constraint, column] of FOREIGN_KEYS) {
    await knex.raw(
      `ALTER TABLE ${table} ADD CONSTRAINT ${constraint} FOREIGN KEY (${column}) REFERENCES bookings (id)`,
    );
  }
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  for (const [table, constraint] of FOREIGN_KEYS) {
    await knex.raw(`ALTER TABLE ??.${table} DROP CONSTRAINT IF EXISTS ${constraint}`, [schema]);
  }
}
