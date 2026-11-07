import { cinemaDayBounds } from '../../common/time/time';
import type { ActivityFilter, ActivitySqlCondition } from './types';

/**
 * The conditions of `GET /admin/activity` on `audit_events e`, ANDed by the repository. Every
 * value is bound; columns are code constants. Dates are cinema days of `occurred_at` (06:00 to
 * 06:00 Cairo time, design §8), `dateTo` inclusive.
 *
 * Indexes (U1, U12): a staff member `idx_audit_events_actor_staff_user_id`, an entity type
 * `idx_audit_events_entity_type`, one item `idx_audit_events_entity_type_entity_id_occurred_at`,
 * otherwise `idx_audit_events_occurred_at` with the date range.
 */
export function activityConditions(filter: ActivityFilter): ActivitySqlCondition[] {
  const conditions: ActivitySqlCondition[] = [];
  if (filter.staffUserId !== undefined) {
    conditions.push({ sql: 'e.actor_staff_user_id = ?', bindings: [filter.staffUserId] });
  }
  if (filter.actorKind !== undefined) {
    conditions.push({ sql: 'e.actor_kind = ?', bindings: [filter.actorKind] });
  }
  if (filter.entityType !== undefined) {
    conditions.push({ sql: 'e.entity_type = ?', bindings: [filter.entityType] });
  }
  if (filter.entityId !== undefined) {
    conditions.push({ sql: 'e.entity_id = ?', bindings: [filter.entityId] });
  }
  if (filter.action !== undefined) {
    conditions.push({ sql: 'e.action = ?', bindings: [filter.action] });
  }
  if (filter.dateFrom !== undefined) {
    conditions.push({
      sql: 'e.occurred_at >= ?',
      bindings: [cinemaDayBounds(filter.dateFrom).startsAt],
    });
  }
  if (filter.dateTo !== undefined) {
    conditions.push({
      sql: 'e.occurred_at < ?',
      bindings: [cinemaDayBounds(filter.dateTo).endsAt],
    });
  }
  return conditions;
}
