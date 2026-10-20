import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U2b (#4): a password setup now also looks a token up before it consumes it (design §10.5), so
 * the unique index on `token_hash` serves a second query. Only its comment changes.
 *
 * Placeholders are written `:name`: Knex rewrites every `?` of a raw statement into `$n`, even
 * inside a string literal.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    COMMENT ON INDEX uq_one_time_tokens_token_hash IS
      'Consume: UPDATE ... WHERE token_hash = :hash AND purpose = :purpose AND used_at IS NULL AND expires_at > :now RETURNING ...; findLive (U2b password setup): SELECT ... WHERE token_hash = :hash AND used_at IS NULL AND expires_at > :now.'
  `);
}

/** Restores the comment exactly as U2a's migration stored it. */
export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw(
    `COMMENT ON INDEX ??.uq_one_time_tokens_token_hash IS
      'Consume: UPDATE ... WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > $3 RETURNING ...'`,
    [schema],
  );
}
