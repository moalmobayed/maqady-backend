import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U12 (#13): a booking's History (design §13.5) reads two branches of `audit_events`: the
 * booking's own events (`idx_audit_events_booking_id`, U1) and the moves of its showtime while it
 * held a ticket. The second filters on `entity_type`, `entity_id` and a time range, which no index
 * served: `idx_audit_events_entity_type` would scan every showtime event. Equality columns first,
 * then the range. An entity's own activity (U19) reads the same columns.
 *
 * Placeholders in the comment are written `:name`: Knex rewrites every `?` of a raw statement into
 * `$n`, even inside a string literal.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    'CREATE INDEX idx_audit_events_entity_type_entity_id_occurred_at ON audit_events (entity_type, entity_id, occurred_at)',
  );
  await knex.raw(`
    COMMENT ON INDEX idx_audit_events_entity_type_entity_id_occurred_at IS
      'A booking History, showtime branch (U12): WHERE entity_type = ''showtime'' AND entity_id = :showtime_id AND action = ANY(:actions) AND occurred_at >= :from AND occurred_at < :until. Also one entity activity (U19).'
  `);
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS ??.idx_audit_events_entity_type_entity_id_occurred_at', [
    schema,
  ]);
}
