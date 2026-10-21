import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U2a (#4): single-use links for staff and customers (design §6.2, §10.5): email verification,
 * customer password reset, staff invite and staff password reset.
 *
 * - Only the SHA-256 of the token is stored. `used_at` makes it single-use.
 * - The owner column matches the purpose (CHECK): staff purposes name a staff member, customer
 *   purposes a customer. `customer_id` gets its foreign key from U9; the covering index is here.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE one_time_tokens (
      id BIGSERIAL PRIMARY KEY,
      purpose VARCHAR(32) NOT NULL,
      staff_user_id BIGINT NULL,
      customer_id BIGINT NULL,
      token_hash VARCHAR(64) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ NULL,
      CONSTRAINT uq_one_time_tokens_token_hash UNIQUE (token_hash),
      CONSTRAINT fk_one_time_tokens_staff_user_id FOREIGN KEY (staff_user_id) REFERENCES staff_users (id),
      CONSTRAINT chk_one_time_tokens_purpose CHECK (purpose IN (
        'verify_email', 'customer_password_reset', 'staff_invite', 'staff_password_reset'
      )),
      CONSTRAINT chk_one_time_tokens_owner CHECK (
        (purpose IN ('staff_invite', 'staff_password_reset')
          AND staff_user_id IS NOT NULL AND customer_id IS NULL)
        OR (purpose IN ('verify_email', 'customer_password_reset')
          AND customer_id IS NOT NULL AND staff_user_id IS NULL)
      ),
      CONSTRAINT chk_one_time_tokens_token_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT chk_one_time_tokens_expiry CHECK (expires_at > created_at)
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE one_time_tokens IS
      'Single-use emailed links: verification, password resets and staff invites (design 10.5).'
  `);
  await knex.raw(`
    COMMENT ON INDEX uq_one_time_tokens_token_hash IS
      'Consume: UPDATE ... WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ? RETURNING ...'
  `);

  const indexes: [string, string, string][] = [
    [
      'idx_one_time_tokens_staff_user_id_purpose',
      '(staff_user_id, purpose)',
      'Invalidate earlier links: DELETE ... WHERE staff_user_id = ? AND purpose = ? AND used_at IS NULL. Covers fk_one_time_tokens_staff_user_id.',
    ],
    [
      'idx_one_time_tokens_customer_id_purpose',
      '(customer_id, purpose)',
      'Invalidate earlier links: DELETE ... WHERE customer_id = ? AND purpose = ? AND used_at IS NULL. Covers fk_one_time_tokens_customer_id (U9).',
    ],
  ];
  for (const [name, columns, comment] of indexes) {
    await knex.raw(`CREATE INDEX ${name} ON one_time_tokens ${columns}`);
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
  await knex.raw('ALTER TABLE one_time_tokens ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.one_time_tokens', [schema]);
}
