import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U2a (#4): refresh-token sessions, shared by staff and customers (design §6.2, §10.2).
 *
 * - One row per refresh token. A sign-in starts a family (`family_id`); every refresh inserts the
 *   next row of the family and marks the presented one rotated (`rotated_at`, `replaced_by_id`).
 * - `expires_at` belongs to the family: a rotated row inherits it, so a session ends 12 hours
 *   (staff) or 30 days (customers) after its sign-in, however often it is refreshed.
 * - Revoking sets `revoked_at` and `revoked_reason` on every row of the family.
 * - Only the SHA-256 of the refresh token is stored.
 * - `customer_id` gets its foreign key from U9, which creates `customers`; the covering index is
 *   here already.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE sessions (
      id BIGSERIAL PRIMARY KEY,
      family_id UUID NOT NULL,
      staff_user_id BIGINT NULL,
      customer_id BIGINT NULL,
      token_hash VARCHAR(64) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      rotated_at TIMESTAMPTZ NULL,
      replaced_by_id BIGINT NULL,
      revoked_at TIMESTAMPTZ NULL,
      revoked_reason VARCHAR(32) NULL,
      CONSTRAINT uq_sessions_token_hash UNIQUE (token_hash),
      CONSTRAINT fk_sessions_staff_user_id FOREIGN KEY (staff_user_id) REFERENCES staff_users (id),
      CONSTRAINT fk_sessions_replaced_by_id FOREIGN KEY (replaced_by_id) REFERENCES sessions (id),
      CONSTRAINT chk_sessions_one_owner CHECK (num_nonnulls(staff_user_id, customer_id) = 1),
      CONSTRAINT chk_sessions_token_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT chk_sessions_expiry CHECK (expires_at > created_at),
      CONSTRAINT chk_sessions_rotation CHECK ((rotated_at IS NULL) = (replaced_by_id IS NULL)),
      CONSTRAINT chk_sessions_revocation CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
      CONSTRAINT chk_sessions_revoked_reason CHECK (revoked_reason IN (
        'sign_out', 'refresh_reuse', 'account_deactivated', 'role_changed', 'password_changed',
        'account_blocked'
      ))
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE sessions IS
      'Refresh-token sessions of staff and customers; one row per token, grouped in families (design 10.2).'
  `);
  await knex.raw(`
    COMMENT ON INDEX uq_sessions_token_hash IS
      'Refresh: SELECT ... WHERE token_hash = ? FOR UPDATE (the presented token).'
  `);

  const indexes: [string, string, string][] = [
    [
      'idx_sessions_family_id',
      '(family_id)',
      'Revoking a family (sign-out, reuse): SELECT ... WHERE family_id = ? AND rotated_at IS NULL FOR UPDATE, then UPDATE ... WHERE family_id = ?.',
    ],
    [
      'idx_sessions_staff_user_id',
      '(staff_user_id)',
      "Revoking all of a staff member's sessions (deactivation, demotion): WHERE staff_user_id = ?. Covers fk_sessions_staff_user_id.",
    ],
    [
      'idx_sessions_customer_id',
      '(customer_id)',
      "Revoking all of a customer's sessions (block, password change): WHERE customer_id = ?. Covers fk_sessions_customer_id (U9).",
    ],
    [
      'idx_sessions_replaced_by_id',
      '(replaced_by_id)',
      'Covers fk_sessions_replaced_by_id, so deleting a session row (anonymisation, U15) checks its predecessor by index.',
    ],
  ];
  for (const [name, columns, comment] of indexes) {
    await knex.raw(`CREATE INDEX ${name} ON sessions ${columns}`);
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
  await knex.raw('ALTER TABLE sessions ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.sessions', [schema]);
}
