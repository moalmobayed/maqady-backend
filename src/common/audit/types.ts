import type { ACTOR_KINDS } from './enums';

export type ActorKind = (typeof ACTOR_KINDS)[number];

/** Who acted: a staff member, a customer, or the system (a settlement, for example). */
export type AuditActor =
  | { readonly kind: 'staff'; readonly id: number }
  | { readonly kind: 'customer'; readonly id: number }
  | { readonly kind: 'system' };

/** A scalar metadata value. Objects are refused so nothing nested can smuggle personal data. */
export type AuditMetadataValue = string | number | boolean | null;

/** What `AuditService.record()` takes. */
export interface AuditEventInput {
  readonly actor: AuditActor;
  /** `noun.verb`, for example `booking.refunded`. */
  readonly action: string;
  readonly entity: { readonly type: string; readonly id: number | null };
  /** Links the event to a booking's History (U12). */
  readonly bookingId?: number | null;
  /** Names of the fields that changed, never their values. */
  readonly changedFields?: readonly string[];
  /** Non-personal facts, such as `{ seatCount: 2, method: 'cash' }`. */
  readonly metadata?: Readonly<Record<string, AuditMetadataValue>>;
}

/** One `audit_events` row as the repository inserts it. */
export interface AuditEventRow {
  readonly occurred_at: Date;
  readonly actor_kind: ActorKind;
  readonly actor_staff_user_id: number | null;
  readonly actor_customer_id: number | null;
  readonly action: string;
  readonly entity_type: string;
  readonly entity_id: number | null;
  readonly booking_id: number | null;
  readonly changed_fields: string[];
  readonly metadata: Readonly<Record<string, AuditMetadataValue>>;
}

/**
 * What a booking's History reads (U12): the booking's own events with these actions and, once it
 * held a ticket, these actions of its showtime between `from` (inclusive) and `until` (exclusive,
 * none when the booking still holds it).
 */
export interface BookingEventsFilter {
  readonly bookingId: number;
  readonly bookingActions: readonly string[];
  readonly showtime: {
    readonly id: number;
    readonly actions: readonly string[];
    readonly from: Date;
    readonly until: Date | null;
  } | null;
}

/** An audit event as a History reads it: when and what, never who or the metadata. */
export interface AuditEventView {
  readonly id: number;
  readonly occurredAt: Date;
  readonly action: string;
}

/** An `audit_events` row as `AuditReadRepository` reads it. */
export interface AuditEventViewRow {
  readonly id: number;
  readonly occurred_at: Date;
  readonly action: string;
}

/** One page of audit events and how many the whole list has. */
export interface AuditEventPage {
  readonly rows: readonly AuditEventView[];
  readonly total: number;
}
