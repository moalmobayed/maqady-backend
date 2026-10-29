import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U16 (#17): the indexes of the Payments screen (design §11, §13.3; PRD A8). Indexes only, so the
 * previous release runs beside them (design §6.1).
 *
 * - The transactions list is newest first by the moment the money moved, or, while it has not
 *   (a processing charge, a pending counter refund), the moment the row was written:
 *   `COALESCE(completed_at, created_at)`. The same expression orders the keyset and bounds the
 *   cinema-date range, so the index is on it, then `id`.
 * - The reconciliation's ledger check reads the bookings confirmed in a period.
 *
 * The KPIs and the provider check read U14's `idx_payments_completed_at`; refunded bookings
 * U14's `idx_bookings_refunded_at`; a charge's refunds U11's `idx_payments_refund_of_payment_id`.
 */
const INDEXES: [name: string, definition: string, comment: string][] = [
  [
    'idx_payments_occurred_at',
    'CREATE INDEX idx_payments_occurred_at ON payments ((COALESCE(completed_at, created_at)), id)',
    'The Payments screen transactions, newest first: ORDER BY COALESCE(completed_at, created_at) DESC, id DESC with the keyset (COALESCE(completed_at, created_at), id) < (?, ?) and the cinema-date range COALESCE(completed_at, created_at) >= ? AND < ? (GET /admin/payments); the bookings with money moved in a period (reconciliation, GET /admin/payments/summary).',
  ],
  [
    'idx_bookings_confirmed_at',
    'CREATE INDEX idx_bookings_confirmed_at ON bookings (confirmed_at) WHERE confirmed_at IS NOT NULL',
    'The bookings confirmed in a period: WHERE confirmed_at >= ? AND confirmed_at < ? (the reconciliation ledger check, GET /admin/payments/summary).',
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
