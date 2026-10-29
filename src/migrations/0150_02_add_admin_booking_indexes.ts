import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U14 (#15): the indexes of the admin bookings list, its search and its summary cards (design
 * §11, §13.2; PRD A6), plus the payments index the Collected and Failed cards read (and U16's
 * period KPIs after them). Indexes only, so the previous release runs beside them (design §6.1).
 *
 * - The list is newest first with a keyset on (`created_at`, `id`) and an optional date range.
 * - Search is a case-insensitive substring of the booking's contact name, email or phone
 *   (`ILIKE '%…%'`), which a B-tree cannot serve; trigram GIN indexes can (pg_trgm, created by
 *   0010_01). `contact_email` is CITEXT, which `gin_trgm_ops` does not take, so its index and its
 *   query cast it to text. A reference is matched exactly through `uq_bookings_reference`.
 */
const INDEXES: [name: string, definition: string, comment: string][] = [
  [
    'idx_bookings_created_at',
    'CREATE INDEX idx_bookings_created_at ON bookings (created_at, id)',
    'The admin bookings list, newest first: ORDER BY created_at DESC, id DESC with the keyset (created_at, id) < (?, ?), and the date range created_at >= ? AND created_at < ? (GET /admin/bookings; the Today card).',
  ],
  [
    'idx_bookings_contact_name_trgm',
    'CREATE INDEX idx_bookings_contact_name_trgm ON bookings USING gin (contact_name gin_trgm_ops)',
    'Admin bookings search: WHERE contact_name ILIKE ? (a substring, any case; GET /admin/bookings?q=, U18 search).',
  ],
  [
    'idx_bookings_contact_email_trgm',
    'CREATE INDEX idx_bookings_contact_email_trgm ON bookings USING gin ((contact_email::text) gin_trgm_ops)',
    'Admin bookings search: WHERE contact_email::text ILIKE ? (a substring, any case; GET /admin/bookings?q=, U18 search).',
  ],
  [
    'idx_bookings_contact_phone_trgm',
    'CREATE INDEX idx_bookings_contact_phone_trgm ON bookings USING gin (contact_phone gin_trgm_ops)',
    'Admin bookings search: WHERE contact_phone ILIKE ? (digits typed anywhere in the number; GET /admin/bookings?q=, U18 search).',
  ],
  [
    'idx_bookings_refunded_at',
    'CREATE INDEX idx_bookings_refunded_at ON bookings (refunded_at) WHERE refunded_at IS NOT NULL',
    'The Refunded card: WHERE refunded_at > ? AND refunded_at <= ? (bookings refunded in the last 7 days, GET /admin/bookings/summary).',
  ],
  [
    'idx_payments_completed_at',
    'CREATE INDEX idx_payments_completed_at ON payments (completed_at) WHERE completed_at IS NOT NULL',
    'Money moved in a period: WHERE completed_at >= ? AND completed_at < ? AND status = ? (the Collected and Failed payments cards of GET /admin/bookings/summary; U16 period KPIs).',
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
