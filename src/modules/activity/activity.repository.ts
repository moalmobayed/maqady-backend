import { Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { TransactionContext } from '../../common/database/transaction-context';
import type { PageRequest } from '../../common/pagination/types';
import { activityConditions } from './activity.sql';
import type { ActivityFilter, ActivityRow } from './types';

const EVENT_COLUMNS = [
  'e.id',
  'e.occurred_at',
  'e.actor_kind',
  'e.actor_staff_user_id',
  'e.actor_customer_id',
  'e.action',
  'e.entity_type',
  'e.entity_id',
  'e.booking_id',
  'e.changed_fields',
  'e.metadata',
] as const;

/**
 * The Activity log's reads (U19; design §5: `activity` is a read-only module with its own queries,
 * like `analytics`): `audit_events`, newest first, each with its booking's reference (a left
 * join on the primary key). Nothing here writes.
 */
@Injectable()
export class ActivityRepository {
  constructor(private readonly db: TransactionContext) {}

  /**
   * Up to `limit + 1` events after the cursor, newest first (`occurred_at DESC, id DESC`,
   * `idx_audit_events_occurred_at`). The cursor's sort key is an ISO instant (checked by the
   * service), bound as a `Date`.
   */
  async page(filter: ActivityFilter, page: PageRequest): Promise<ActivityRow[]> {
    const query = this.events(filter)
      .leftJoin({ b: 'bookings' }, 'b.id', 'e.booking_id')
      .select<ActivityRow[]>([...EVENT_COLUMNS, 'b.reference AS booking_reference'])
      .orderBy([
        { column: 'e.occurred_at', order: 'desc' },
        { column: 'e.id', order: 'desc' },
      ])
      .limit(page.limit + 1);
    if (page.after) {
      query.andWhereRaw('(e.occurred_at, e.id) < (?, ?)', [
        new Date(String(page.after.sortKey)),
        page.after.id,
      ]);
    }
    return query;
  }

  /** How many events match these filters. */
  async count(filter: ActivityFilter): Promise<number> {
    const row = await this.events(filter).count<{ count: number }[]>({ count: 'e.id' }).first();
    return row?.count ?? 0;
  }

  private events(filter: ActivityFilter): Knex.QueryBuilder {
    const query = this.db.executor()({ e: 'audit_events' });
    for (const condition of activityConditions(filter)) {
      query.andWhereRaw(condition.sql, [...condition.bindings]);
    }
    return query;
  }
}
