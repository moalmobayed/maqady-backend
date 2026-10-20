import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U4b (#5): the uploader of an image is a staff member (design §6.1). U4a created `images` before
 * `staff_users` was in its dependencies, with the covering index `idx_images_created_by_staff_id`;
 * this is the first unit that depends on both. Staff members are never deleted (they are
 * deactivated), so the default `NO ACTION` keeps an uploader's history.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE images
      ADD CONSTRAINT fk_images_created_by_staff_id
      FOREIGN KEY (created_by_staff_id) REFERENCES staff_users (id)
  `);
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('ALTER TABLE ??.images DROP CONSTRAINT IF EXISTS fk_images_created_by_staff_id', [
    schema,
  ]);
}
