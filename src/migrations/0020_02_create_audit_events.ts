import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U1 (#2): the activity log (design §6.2, §13.5). Never personal data: the names of changed
 * fields, not their values.
 *
 * The actor and booking columns get their foreign keys from the units that create the tables
 * they reference: `staff_users` (U2), `customers` (U9) and `bookings` (U10). Each already has the
 * covering index those keys need.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE audit_events (
      id BIGSERIAL PRIMARY KEY,
      occurred_at TIMESTAMPTZ NOT NULL,
      actor_kind VARCHAR(16) NOT NULL,
      actor_staff_user_id BIGINT NULL,
      actor_customer_id BIGINT NULL,
      action VARCHAR(64) NOT NULL,
      entity_type VARCHAR(32) NOT NULL,
      entity_id BIGINT NULL,
      booking_id BIGINT NULL,
      changed_fields TEXT[] NOT NULL,
      metadata JSONB NOT NULL,
      CONSTRAINT chk_audit_events_actor_kind CHECK (actor_kind IN ('staff', 'customer', 'system')),
      CONSTRAINT chk_audit_events_actor CHECK (
        (actor_kind = 'staff' AND actor_staff_user_id IS NOT NULL AND actor_customer_id IS NULL)
        OR (actor_kind = 'customer' AND actor_customer_id IS NOT NULL AND actor_staff_user_id IS NULL)
        OR (actor_kind = 'system' AND actor_staff_user_id IS NULL AND actor_customer_id IS NULL)
      ),
      CONSTRAINT chk_audit_events_action CHECK (action ~ '^[a-z][a-z_]*(\\.[a-z][a-z_]*)+$'),
      CONSTRAINT chk_audit_events_entity_type CHECK (entity_type ~ '^[a-z][a-z_]*$'),
      CONSTRAINT chk_audit_events_metadata CHECK (jsonb_typeof(metadata) = 'object')
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE audit_events IS
      'Activity log: who did what to which entity; changed field names only, never values (design 13.5).'
  `);

  const indexes: [string, string, string][] = [
    [
      'idx_audit_events_occurred_at',
      '(occurred_at DESC, id DESC)',
      'Activity log, newest first: ORDER BY occurred_at DESC, id DESC with a cursor, optionally a date range.',
    ],
    [
      'idx_audit_events_actor_staff_user_id',
      '(actor_staff_user_id, occurred_at DESC)',
      'Activity log filtered by staff member: WHERE actor_staff_user_id = ? ORDER BY occurred_at DESC. Covers fk_audit_events_actor_staff_user_id (U2).',
    ],
    [
      'idx_audit_events_entity_type',
      '(entity_type, occurred_at DESC)',
      'Activity log filtered by entity type: WHERE entity_type = ? ORDER BY occurred_at DESC.',
    ],
    [
      'idx_audit_events_booking_id',
      '(booking_id, occurred_at)',
      "A booking's History: WHERE booking_id = ? ORDER BY occurred_at. Covers fk_audit_events_booking_id (U10).",
    ],
    [
      'idx_audit_events_actor_customer_id',
      '(actor_customer_id)',
      "A customer's events, for anonymisation: WHERE actor_customer_id = ?. Covers fk_audit_events_actor_customer_id (U9).",
    ],
  ];
  for (const [name, columns, comment] of indexes) {
    await knex.raw(`CREATE INDEX ${name} ON audit_events ${columns}`);
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
  await knex.raw('ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.audit_events', [schema]);
}
