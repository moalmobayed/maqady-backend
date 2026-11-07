import { cinemaDayBounds } from '../../common/time/time';
import { COUNTER_PAYMENT_METHODS, ONLINE_PAYMENT_METHODS } from '../payments/enums';
import { transactionStatusPredicate } from './transaction-status.sql';
import type { TransactionFilter, TransactionSqlCondition } from './types';

/** When a row's money moved, or (still processing or pending) when it was written. */
export const OCCURRED_AT_SQL = 'COALESCE(p.completed_at, p.created_at)';

/**
 * The conditions of `GET /admin/payments`, ANDed by the repository, on `payments p` joined to its
 * booking `b`, showtime `s` and theater `t`. Every value is bound; aliases and columns are code
 * constants. The date range is cinema days of `occurredAt` (06:00 to 06:00 Cairo time, design §8),
 * served by `idx_payments_occurred_at`. U19's payments CSV reuses it.
 */
export function transactionConditions(filter: TransactionFilter): TransactionSqlCondition[] {
  const conditions: TransactionSqlCondition[] = [];
  if (filter.kind !== undefined) {
    conditions.push({ sql: 'p.kind = ?', bindings: [filter.kind] });
  }
  if (filter.method !== undefined) {
    conditions.push({ sql: 'p.method = ?', bindings: [filter.method] });
  }
  if (filter.channel !== undefined) {
    const methods = filter.channel === 'online' ? ONLINE_PAYMENT_METHODS : COUNTER_PAYMENT_METHODS;
    conditions.push({
      sql: `p.method IN (${methods.map(() => '?').join(', ')})`,
      bindings: [...methods],
    });
  }
  if (filter.status !== undefined) {
    conditions.push(transactionStatusPredicate(filter.status, 'p'));
  }
  if (filter.theaterId !== undefined) {
    conditions.push({ sql: 's.theater_id = ?', bindings: [filter.theaterId] });
  }
  if (filter.dateFrom !== undefined) {
    conditions.push({
      sql: `${OCCURRED_AT_SQL} >= ?`,
      bindings: [cinemaDayBounds(filter.dateFrom).startsAt],
    });
  }
  if (filter.dateTo !== undefined) {
    conditions.push({
      sql: `${OCCURRED_AT_SQL} < ?`,
      bindings: [cinemaDayBounds(filter.dateTo).endsAt],
    });
  }
  return conditions;
}
