import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U1 (#2): stored results of writes (design §6.2, §14.1, ADR 0003).
 *
 * - One row per (scope, key). A key older than 24 hours counts as absent; the service judges that
 *   from `created_at` (written from the Clock, so no default) when it claims a key.
 * - `response_ciphertext` is the response body encrypted with AES-256-GCM; NULL for an empty body.
 * - `response_status` is NULL only while the first request is still in flight, which no other
 *   transaction can see.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE idempotency_keys (
      id BIGSERIAL PRIMARY KEY,
      scope VARCHAR(64) NOT NULL,
      key VARCHAR(128) NOT NULL,
      request_hash VARCHAR(64) NOT NULL,
      response_status SMALLINT NULL,
      response_ciphertext TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT uq_idempotency_keys_scope_key UNIQUE (scope, key),
      CONSTRAINT chk_idempotency_keys_scope CHECK (scope ~ '^(anonymous|customer:[1-9][0-9]*|staff:[1-9][0-9]*)$'),
      CONSTRAINT chk_idempotency_keys_key CHECK (key ~ '^[A-Za-z0-9_-]{1,128}$'),
      CONSTRAINT chk_idempotency_keys_request_hash CHECK (request_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT chk_idempotency_keys_response_status CHECK (response_status BETWEEN 200 AND 299)
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE idempotency_keys IS
      'Stored results of writes, replayed for a retried Idempotency-Key (design 14.1).'
  `);
  await knex.raw(`
    COMMENT ON INDEX uq_idempotency_keys_scope_key IS
      'Claim and replay: INSERT ... ON CONFLICT (scope, key) and SELECT ... WHERE scope = ? AND key = ?; anonymisation deletes by scope.'
  `);
  await knex.raw('CREATE INDEX idx_idempotency_keys_created_at ON idempotency_keys (created_at)');
  await knex.raw(`
    COMMENT ON INDEX idx_idempotency_keys_created_at IS
      'Opportunistic purge: SELECT id ... WHERE created_at < ? LIMIT 50 FOR UPDATE SKIP LOCKED.'
  `);
  await knex.raw('ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.idempotency_keys', [schema]);
}
