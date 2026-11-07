import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U13 (#14): a counter charge's receipt reference (design §6.2, §7.6; PRD Payments 2). Card
 * terminals are not connected, so staff type the terminal's receipt reference, and it is stored
 * in `provider_reference`, which U11 already describes as "a card terminal's receipt reference at
 * the counter". A card-terminal charge must carry one in the form the API accepts; a cash charge
 * never has one. Online methods and refunds are not touched. (`IS NOT NULL` is spelled out: a
 * regular expression on NULL is NULL, which a CHECK lets through.)
 *
 * No counter charge exists before this unit, so no row can violate it and the previous release
 * keeps working beside it (design §6.1, backward-compatible migrations).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE payments
      ADD CONSTRAINT chk_payments_receipt_reference CHECK (
        kind = 'refund'
        OR method IN ('card', 'wallet')
        OR (method = 'cash' AND provider_reference IS NULL)
        OR (method = 'card_terminal'
            AND provider_reference IS NOT NULL
            AND provider_reference ~ '^[A-Za-z0-9][A-Za-z0-9 ./_-]{0,63}$'))
  `);
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw(
    'ALTER TABLE ??.payments DROP CONSTRAINT IF EXISTS chk_payments_receipt_reference',
    [schema],
  );
}
