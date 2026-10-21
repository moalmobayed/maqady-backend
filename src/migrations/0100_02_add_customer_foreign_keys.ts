import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U9 (#10): the tables that name a customer now point at `customers` (design §6.2). Each column
 * already has its covering index: `idx_sessions_customer_id` and
 * `idx_one_time_tokens_customer_id_purpose` (U2a), `idx_messages_related_customer_id` (U3) and
 * `idx_audit_events_actor_customer_id` (U1). No `ON DELETE`: customers are anonymised, never
 * deleted.
 */
const FOREIGN_KEYS: readonly (readonly [table: string, constraint: string, column: string])[] = [
  ['sessions', 'fk_sessions_customer_id', 'customer_id'],
  ['one_time_tokens', 'fk_one_time_tokens_customer_id', 'customer_id'],
  ['messages', 'fk_messages_related_customer_id', 'related_customer_id'],
  ['audit_events', 'fk_audit_events_actor_customer_id', 'actor_customer_id'],
];

export async function up(knex: Knex): Promise<void> {
  for (const [table, constraint, column] of FOREIGN_KEYS) {
    await knex.raw(
      `ALTER TABLE ${table} ADD CONSTRAINT ${constraint} FOREIGN KEY (${column}) REFERENCES customers (id)`,
    );
  }
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  for (const [table, constraint] of FOREIGN_KEYS) {
    await knex.raw(`ALTER TABLE ??.${table} DROP CONSTRAINT IF EXISTS ${constraint}`, [schema]);
  }
}
