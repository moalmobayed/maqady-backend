import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * #29 P3: a theater's postal code and WhatsApp number (API Data Gaps Report items 6 and 9;
 * docs/gh-29-theater-fields). The postal code is shown with the city ("Cairo 11211"); Egyptian
 * postal codes are 5 digits, and a leading zero matters, so it is text. The WhatsApp number is
 * E.164, the CHECK of `theater_phones.number`, and is public only while the theater shows its
 * contacts. Nothing filters or sorts by either, so there is no index.
 *
 * Expand only: both columns are nullable without a default, and the previous release names its
 * columns and never writes these, so it runs beside this one (design §6.1).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE theaters
      ADD COLUMN postal_code VARCHAR(10) NULL,
      ADD COLUMN whatsapp VARCHAR(16) NULL,
      ADD CONSTRAINT chk_theaters_postal_code CHECK (postal_code ~ '^[0-9]{5}$'),
      ADD CONSTRAINT chk_theaters_whatsapp CHECK (whatsapp ~ '^[+][1-9][0-9]{6,14}$')
  `);
  await knex.raw(`
    COMMENT ON COLUMN theaters.postal_code IS
      'Postal code shown with the city (Cairo 11211): 5 digits; NULL when the theater has none.'
  `);
  await knex.raw(`
    COMMENT ON COLUMN theaters.whatsapp IS
      'Dedicated WhatsApp number, E.164; public only while show_contacts_public is true. NULL when none.'
  `);
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw(
    'ALTER TABLE ??.theaters DROP COLUMN IF EXISTS whatsapp, DROP COLUMN IF EXISTS postal_code',
    [schema],
  );
}
