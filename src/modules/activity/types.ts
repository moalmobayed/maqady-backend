import type { ActorKind, AuditMetadataValue } from '../../common/audit/types';
import type { CalendarDate } from '../../common/time/types';
import type { StaffRef } from '../bookings/types';

/** `GET /admin/activity` filters (PRD "filterable by staff member, item type and date"), ANDed. */
export interface ActivityFilter {
  readonly staffUserId?: number;
  readonly actorKind?: ActorKind;
  readonly entityType?: string;
  /** One item's activity; only with `entityType`. */
  readonly entityId?: number;
  readonly action?: string;
  /** Cinema dates of `occurredAt`, inclusive. */
  readonly dateFrom?: CalendarDate;
  readonly dateTo?: CalendarDate;
}

/** A bound SQL condition the repository ANDs, on `audit_events e`; columns are code constants. */
export interface ActivitySqlCondition {
  readonly sql: string;
  readonly bindings: readonly (string | number | Date)[];
}

/** One `audit_events` row as the Activity log reads it, with its booking's reference. */
export interface ActivityRow {
  readonly id: number;
  readonly occurred_at: Date;
  readonly actor_kind: ActorKind;
  readonly actor_staff_user_id: number | null;
  readonly actor_customer_id: number | null;
  readonly action: string;
  readonly entity_type: string;
  readonly entity_id: number | null;
  readonly booking_id: number | null;
  readonly booking_reference: string | null;
  readonly changed_fields: string[] | null;
  readonly metadata: Readonly<Record<string, AuditMetadataValue>> | null;
}

/** Who acted: a staff member by name, a customer by id only, or the system. */
export interface ActivityActor {
  readonly kind: ActorKind;
  readonly staff: StaffRef | null;
  readonly customerId: number | null;
}

/** What the event is about. */
export interface ActivityEntity {
  readonly type: string;
  readonly id: number | null;
}

/** One event of the Activity log: time, who, what and which item (PRD "Activity log"). */
export interface ActivityEvent {
  readonly id: number;
  readonly occurredAt: Date;
  readonly action: string;
  readonly actor: ActivityActor;
  readonly entity: ActivityEntity;
  /** The booking the event belongs to (booking and payment events), by its reference. */
  readonly bookingReference: string | null;
  readonly changedFields: readonly string[];
  readonly metadata: Readonly<Record<string, AuditMetadataValue>>;
}
