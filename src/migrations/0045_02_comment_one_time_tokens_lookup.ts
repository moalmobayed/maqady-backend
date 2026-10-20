import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U2b (#4): a password setup now also looks a token up before it consumes it (design §10.5), so
 * the unique index on `token_hash` serves a second query. Only its comment changes.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    COMMENT ON INDEX uq_one_time_tokens_token_hash IS
      'Consume: UPDATE ... WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ? RETURNING ...; findLive: SELECT ... WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? (U2b password setup).'
  `);
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  // The `?` of the restored comment are escaped (`\\?`), so Knex binds only the schema.
  await knex.raw(
    `COMMENT ON INDEX ??.uq_one_time_tokens_token_hash IS
      'Consume: UPDATE ... WHERE token_hash = \\? AND purpose = \\? AND used_at IS NULL AND expires_at > \\? RETURNING ...'`,
    [schema],
  );
}
