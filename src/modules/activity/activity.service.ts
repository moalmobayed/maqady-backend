import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { toPage, toPageRequest } from '../../common/pagination/cursor';
import { INVALID_CURSOR_MESSAGE } from '../../common/pagination/pagination.constants';
import type { Page, PageQueryInput } from '../../common/pagination/types';
import type { StaffRef } from '../bookings/types';
import { StaffService } from '../staff/staff.service';
import { ActivityRepository } from './activity.repository';
import type { ActivityEvent, ActivityFilter, ActivityRow } from './types';

/**
 * The admin Activity log (PRD "Activity log"; design §13.5): every audit event, newest first,
 * with who did it, what and to which item, filtered by staff member, actor kind, item type, one
 * item, action and cinema dates, cursor-paginated with `total`.
 *
 * Audit events never hold personal data (design §13.5: changed field names, never values, and
 * `AuditService` refuses metadata keys that suggest personal data), so the event is shown whole.
 * A customer who acted is shown by id only; a staff member by name, the dashboard's own users.
 * One query for the page, one for the total and one for the staff names: no N+1.
 */
@Injectable()
export class ActivityService {
  constructor(
    private readonly activity: ActivityRepository,
    private readonly staff: StaffService,
  ) {}

  /**
   * `VALIDATION_FAILED` for a tampered cursor, `entityId` without `entityType`, or `dateTo`
   * before `dateFrom`.
   */
  async list(filter: ActivityFilter, query: PageQueryInput): Promise<Page<ActivityEvent>> {
    const request = toPageRequest(query, 'instant');
    if (request.after !== null && request.after.sortKey === null) {
      throw invalid('cursor', INVALID_CURSOR_MESSAGE);
    }
    if (filter.entityId !== undefined && filter.entityType === undefined) {
      throw invalid('entityId', 'entityId needs entityType');
    }
    if (
      filter.dateFrom !== undefined &&
      filter.dateTo !== undefined &&
      filter.dateFrom > filter.dateTo
    ) {
      throw invalid('dateTo', 'dateTo must be on or after dateFrom');
    }
    // One after the other: inside a transaction they would share one connection.
    const rows = await this.activity.page(filter, request);
    const total = await this.activity.count(filter);
    const refs = await this.staffRefs(
      rows.slice(0, request.limit).map((row) => row.actor_staff_user_id),
    );
    return toPage(
      rows,
      request,
      total,
      (row) => ({ sortKey: row.occurred_at.toISOString(), id: row.id }),
      (row) => toEvent(row, refs),
    );
  }

  private async staffRefs(ids: readonly (number | null)[]): Promise<ReadonlyMap<number, StaffRef>> {
    const wanted = [...new Set(ids.filter((id): id is number => id !== null))];
    if (wanted.length === 0) return new Map();
    const members = await this.staff.findByIds(wanted);
    return new Map(
      [...members.values()].map((member) => [
        member.id,
        { id: member.id, fullName: member.fullName },
      ]),
    );
  }
}

/** An event from its row and the staff names already read. */
export function toEvent(row: ActivityRow, refs: ReadonlyMap<number, StaffRef>): ActivityEvent {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    action: row.action,
    actor: {
      kind: row.actor_kind,
      staff: row.actor_staff_user_id === null ? null : (refs.get(row.actor_staff_user_id) ?? null),
      customerId: row.actor_customer_id,
    },
    entity: { type: row.entity_type, id: row.entity_id },
    bookingReference: row.booking_reference,
    changedFields: row.changed_fields ?? [],
    metadata: row.metadata ?? {},
  };
}

function invalid(field: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', undefined, {
    fields: [{ field, messages: [message] }],
  });
}
