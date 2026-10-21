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
