import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U15 (#16): the indexes of the admin customers list and its search (design §11, §13.2; PRD A7).
 * Indexes only, so the previous release runs beside them (design §6.1).
 *
 * - The list is newest account first with a keyset on (`created_at`, `id`); anonymised rows are
 *   never listed, so the index holds live rows only.
 * - Search is a case-insensitive substring of the name, email or phone (`ILIKE '%…%'`), which a
 *   B-tree cannot serve; trigram GIN indexes can (pg_trgm, created by 0010_01). `email` is CITEXT,
 *   which `gin_trgm_ops` does not take, so its index and its query cast it to text.
 */
const INDEXES: [name: string, definition: string, comment: string][] = [
  [
    'idx_customers_created_at',
    'CREATE INDEX idx_customers_created_at ON customers (created_at, id) WHERE deleted_at IS NULL',
    'The admin customers list, newest first: WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC with the keyset (created_at, id) < (?, ?) (GET /admin/customers).',
  ],
  [
    'idx_customers_full_name_trgm',
    'CREATE INDEX idx_customers_full_name_trgm ON customers USING gin (full_name gin_trgm_ops)',
    'Admin customers search: WHERE full_name ILIKE ? (a substring, any case; GET /admin/customers?q=, U18 search).',
  ],
  [
    'idx_customers_email_trgm',
    'CREATE INDEX idx_customers_email_trgm ON customers USING gin ((email::text) gin_trgm_ops)',
    'Admin customers search: WHERE email::text ILIKE ? (a substring, any case; GET /admin/customers?q=, U18 search).',
  ],
  [
    'idx_customers_phone_trgm',
    'CREATE INDEX idx_customers_phone_trgm ON customers USING gin (phone gin_trgm_ops)',
    'Admin customers search: WHERE phone ILIKE ? (digits typed anywhere in the number; GET /admin/customers?q=, U18 search).',
  ],
];

export async function up(knex: Knex): Promise<void> {
  for (const [name, definition, comment] of INDEXES) {
    await knex.raw(definition);
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  for (const [name] of [...INDEXES].reverse()) {
    await knex.raw('DROP INDEX IF EXISTS ??.??', [schema, name]);
  }
}
