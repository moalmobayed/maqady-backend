import { Injectable } from '@nestjs/common';
import { AppError } from '../errors/app-error';
import { Clock } from '../time/clock';
import {
  AUDIT_ACTION_PATTERN,
  AUDIT_ENTITY_TYPE_PATTERN,
  AUDIT_FIELD_PATTERN,
  FORBIDDEN_METADATA_KEY,
  MAX_ACTION_LENGTH,
  MAX_ENTITY_TYPE_LENGTH,
} from './audit.constants';
import { AuditRepository } from './audit.repository';
import type { AuditEventInput, AuditMetadataValue } from './types';

/**
 * The activity log's write side (design §13.5). Call `record()` inside the transaction of every
 * staff write and of customer booking events: the row commits or rolls back with the change.
 *
 * The log holds no personal data. Changed fields are stored by name only, and metadata is limited
 * to scalars under keys that don't suggest personal data. A violation is a bug, so it fails the
 * request with `INTERNAL` rather than writing the data.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly repository: AuditRepository,
    private readonly clock: Clock,
  ) {}

  async record(event: AuditEventInput): Promise<number> {
    validateEvent(event);
    const { actor } = event;
    return this.repository.insert({
      occurred_at: this.clock.now(),
      actor_kind: actor.kind,
      actor_staff_user_id: actor.kind === 'staff' ? actor.id : null,
      actor_customer_id: actor.kind === 'customer' ? actor.id : null,
      action: event.action,
      entity_type: event.entity.type,
      entity_id: event.entity.id,
      booking_id: event.bookingId ?? null,
      changed_fields: [...new Set(event.changedFields ?? [])].sort(),
      metadata: event.metadata ?? {},
    });
  }
}

function validateEvent(event: AuditEventInput): void {
  if (event.action.length > MAX_ACTION_LENGTH || !AUDIT_ACTION_PATTERN.test(event.action)) {
    throw new AppError('INTERNAL', 'An audit action must look like noun.verb.');
  }
  const { type } = event.entity;
  if (type.length > MAX_ENTITY_TYPE_LENGTH || !AUDIT_ENTITY_TYPE_PATTERN.test(type)) {
    throw new AppError('INTERNAL', 'An audit entity type must be a lower-case name.');
  }
  for (const field of event.changedFields ?? []) {
    if (!AUDIT_FIELD_PATTERN.test(field)) {
      throw new AppError('INTERNAL', 'Audit events record field names, never values.');
    }
  }
  for (const [key, value] of Object.entries(event.metadata ?? {})) {
    if (FORBIDDEN_METADATA_KEY.test(key) || !isScalar(value)) {
      throw new AppError('INTERNAL', 'Audit metadata must not hold personal data.');
    }
  }
}

function isScalar(value: AuditMetadataValue): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}
