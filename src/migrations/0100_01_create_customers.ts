import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U9 (#10): customer accounts (design §6.2, §10.1).
 *
 * - A live row has an email, a name and a password hash. Anonymisation (U15) clears the email,
 *   name, phone and hash and sets `deleted_at`; the row stays so past bookings keep their owner.
 * - The email is unique among live rows only, so an anonymised customer's address can register
 *   again. `CITEXT` makes the uniqueness and every lookup case-insensitive.
 * - The phone is optional and always E.164, so U3's SMS sender accepts every stored number.
 * - No defaults: every timestamp is written by the service from the Clock.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE customers (
      id BIGSERIAL PRIMARY KEY,
      email CITEXT NULL,
      full_name VARCHAR(100) NULL,
      phone VARCHAR(16) NULL,
      password_hash TEXT NULL,
      status VARCHAR(16) NOT NULL,
      email_verified_at TIMESTAMPTZ NULL,
      last_sign_in_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      deleted_at TIMESTAMPTZ NULL,
      CONSTRAINT chk_customers_status CHECK (status IN ('active', 'blocked')),
      CONSTRAINT chk_customers_email CHECK (length(email) <= 320 AND email ~ '^[^\\s@]+@[^\\s@]+$'),
      CONSTRAINT chk_customers_full_name CHECK (btrim(full_name) <> ''),
      CONSTRAINT chk_customers_phone CHECK (phone ~ '^[+][1-9][0-9]{7,14}$'),
      CONSTRAINT chk_customers_password_hash CHECK (
        password_hash ~ '^scrypt[$][0-9]+[$][0-9]+[$][0-9]+[$][A-Za-z0-9_-]+[$][A-Za-z0-9_-]+$'
      ),
      CONSTRAINT chk_customers_live_or_anonymised CHECK (
        (deleted_at IS NULL AND email IS NOT NULL AND full_name IS NOT NULL
          AND password_hash IS NOT NULL)
        OR (deleted_at IS NOT NULL AND email IS NULL AND full_name IS NULL AND phone IS NULL
          AND password_hash IS NULL)
      ),
      CONSTRAINT chk_customers_updated_at CHECK (updated_at >= created_at)
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE customers IS
      'Customer accounts (design 6.2, 10.1). Anonymised rows keep their id and lose every personal field.'
  `);
  await knex.raw(
    'CREATE UNIQUE INDEX uq_customers_email_live ON customers (email) WHERE deleted_at IS NULL',
  );
  await knex.raw(`
    COMMENT ON INDEX uq_customers_email_live IS
      'Registration: INSERT ... ON CONFLICT (email) WHERE deleted_at IS NULL DO NOTHING; sign-in and forgot-password lookup: WHERE email = ? AND deleted_at IS NULL (CITEXT, so case-insensitive).'
  `);
  await knex.raw('ALTER TABLE customers ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.customers', [schema]);
}
