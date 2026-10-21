import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U2a (#4): the activity log's staff actor now has its table (design §6.2). U1 created the
 * covering index `idx_audit_events_actor_staff_user_id` with `audit_events`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE audit_events
      ADD CONSTRAINT fk_audit_events_actor_staff_user_id
      FOREIGN KEY (actor_staff_user_id) REFERENCES staff_users (id)
  `);
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw(
    'ALTER TABLE ??.audit_events DROP CONSTRAINT IF EXISTS fk_audit_events_actor_staff_user_id',
    [schema],
  );
}
