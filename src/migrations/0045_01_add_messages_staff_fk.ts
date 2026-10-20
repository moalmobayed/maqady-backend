import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U2b (#4): a message's related staff member now has its table (design §6.2, §13.1). U3 created
 * the covering index `idx_messages_related_staff_user_id` with `messages`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE messages
      ADD CONSTRAINT fk_messages_related_staff_user_id
      FOREIGN KEY (related_staff_user_id) REFERENCES staff_users (id)
  `);
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw(
    'ALTER TABLE ??.messages DROP CONSTRAINT IF EXISTS fk_messages_related_staff_user_id',
    [schema],
  );
}
