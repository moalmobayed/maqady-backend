import { Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { TransactionContext } from '../database/transaction-context';
import type { PageRequest } from '../pagination/types';
import type { AuditEventViewRow, BookingEventsFilter } from './types';

const VIEW_COLUMNS = ['id', 'occurred_at', 'action'] as const;

/**
 * Reads `audit_events` for a booking's History (design §13.5, U12), on the current executor.
 * The booking branch is served by `idx_audit_events_booking_id`, the showtime branch by
 * `idx_audit_events_entity_type_entity_id_occurred_at`. Rows come oldest first, `(occurred_at,
 * id)` the keyset.
 */
@Injectable()
export class AuditReadRepository {
  constructor(private readonly db: TransactionContext) {}

  /**
   * Up to `limit + 1` events after the cursor. The cursor's sort key is an ISO instant (checked
   * by the caller's `toPageRequest`); it is bound as a `Date`, so Postgres never parses the
   * client's text.
   */
  async bookingEvents(
    filter: BookingEventsFilter,
    page: PageRequest,
  ): Promise<AuditEventViewRow[]> {
    const query = this.filtered(filter)
      .select<AuditEventViewRow[]>(VIEW_COLUMNS)
      .orderBy([
        { column: 'occurred_at', order: 'asc' },
        { column: 'id', order: 'asc' },
      ])
      .limit(page.limit + 1);
    if (page.after) {
      query.whereRaw('(occurred_at, id) > (?, ?)', [
        new Date(String(page.after.sortKey)),
        page.after.id,
      ]);
    }
    return query;
  }

  async countBookingEvents(filter: BookingEventsFilter): Promise<number> {
    const row = await this.filtered(filter).count<{ count: number }[]>({ count: 'id' }).first();
    return row?.count ?? 0;
  }

  private filtered(filter: BookingEventsFilter): Knex.QueryBuilder {
    const own = 'booking_id = ? AND action = ANY(?::text[])';
    const bindings: Knex.RawBinding[] = [filter.bookingId, [...filter.bookingActions]];
    const { showtime } = filter;
    if (!showtime) return this.events().whereRaw(`(${own})`, bindings);
    const moves = `entity_type = 'showtime' AND entity_id = ? AND action = ANY(?::text[]) AND occurred_at >= ?${
      showtime.until === null ? '' : ' AND occurred_at < ?'
    }`;
    bindings.push(showtime.id, [...showtime.actions], showtime.from);
    if (showtime.until !== null) bindings.push(showtime.until);
    return this.events().whereRaw(`((${own}) OR (${moves}))`, bindings);
  }

  private events(): Knex.QueryBuilder {
    return this.db.executor()('audit_events');
  }
}
