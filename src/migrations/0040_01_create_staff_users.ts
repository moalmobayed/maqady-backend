import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U2a (#4): staff accounts (design §6.2, §10.1).
 *
 * - `password_hash` is NULL until the member sets a password (an invite, U2b); an active member
 *   always has one. A deactivated member keeps whatever they had.
 * - The hash is self-describing (`scrypt$N$r$p$salt$key`), so the profile can change later
 *   without a migration.
 * - No defaults: every timestamp is written by the service from the Clock.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE staff_users (
      id BIGSERIAL PRIMARY KEY,
      email CITEXT NOT NULL,
      full_name VARCHAR(100) NOT NULL,
      role VARCHAR(16) NOT NULL,
      status VARCHAR(16) NOT NULL,
      password_hash TEXT NULL,
      last_sign_in_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT uq_staff_users_email UNIQUE (email),
      CONSTRAINT chk_staff_users_email CHECK (length(email) <= 320 AND email ~ '^[^\\s@]+@[^\\s@]+$'),
      CONSTRAINT chk_staff_users_full_name CHECK (btrim(full_name) <> ''),
      CONSTRAINT chk_staff_users_role CHECK (role IN ('admin', 'box_office')),
      CONSTRAINT chk_staff_users_status CHECK (status IN ('invited', 'active', 'deactivated')),
      CONSTRAINT chk_staff_users_password CHECK (
        (status = 'invited' AND password_hash IS NULL)
        OR (status = 'active' AND password_hash IS NOT NULL)
        OR status = 'deactivated'
      ),
      CONSTRAINT chk_staff_users_password_hash CHECK (
        password_hash ~ '^scrypt[$][0-9]+[$][0-9]+[$][0-9]+[$][A-Za-z0-9_-]+[$][A-Za-z0-9_-]+$'
      ),
      CONSTRAINT chk_staff_users_updated_at CHECK (updated_at >= created_at)
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE staff_users IS
      'Staff accounts: admins and box office (design 6.2, 10.1). The role is read from here on every request.'
  `);
  await knex.raw(`
    COMMENT ON INDEX uq_staff_users_email IS
      'Sign-in lookup: WHERE email = ? (CITEXT, so case-insensitive); admin:create and the U2b invite duplicate check.'
  `);

  const indexes: [string, string, string][] = [
    [
      'idx_staff_users_active_admins',
      "(id) WHERE role = 'admin' AND status = 'active'",
      "The last-admin lock: SELECT id ... WHERE role = 'admin' AND status = 'active' ORDER BY id FOR NO KEY UPDATE.",
    ],
    [
      'idx_staff_users_full_name_id',
      '(full_name, id)',
      'GET /admin/staff: ORDER BY full_name, id with the cursor (full_name, id) > (?, ?), optionally filtered by role or status.',
    ],
  ];
  for (const [name, definition, comment] of indexes) {
    await knex.raw(`CREATE INDEX ${name} ON staff_users ${definition}`);
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
  await knex.raw('ALTER TABLE staff_users ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.staff_users', [schema]);
}
