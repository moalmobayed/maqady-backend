import { Injectable } from '@nestjs/common';
import type { Page } from '../../common/pagination/types';
import { cinemaDateOf, formatCairoIso } from '../../common/time/time';
import { StaffRefResponse } from '../bookings/dto/admin-payment.response';
import {
  ActivityActorResponse,
  ActivityBookingResponse,
  ActivityEntityResponse,
  ActivityEventPageResponse,
  ActivityEventResponse,
} from './dto/activity-event.response';
import type { ActivityEvent } from './types';

/** Response DTOs of the Activity log (U19): times in Cairo ISO with their cinema date. */
@Injectable()
export class ActivityResponseMapper {
  page(page: Page<ActivityEvent>): ActivityEventPageResponse {
    return Object.assign(new ActivityEventPageResponse(), {
      items: page.items.map((event) => this.event(event)),
      nextCursor: page.nextCursor,
      total: page.total,
    });
  }

  event(event: ActivityEvent): ActivityEventResponse {
    const { staff } = event.actor;
    return Object.assign(new ActivityEventResponse(), {
      id: event.id,
      occurredAt: formatCairoIso(event.occurredAt),
      cinemaDate: cinemaDateOf(event.occurredAt),
      action: event.action,
      actor: Object.assign(new ActivityActorResponse(), {
        kind: event.actor.kind,
        staff:
          staff === null
            ? null
            : Object.assign(new StaffRefResponse(), { id: staff.id, fullName: staff.fullName }),
        customerId: event.actor.customerId,
      }),
      entity: Object.assign(new ActivityEntityResponse(), {
        type: event.entity.type,
        id: event.entity.id,
      }),
      booking:
        event.bookingReference === null
          ? null
          : Object.assign(new ActivityBookingResponse(), { reference: event.bookingReference }),
      changedFields: [...event.changedFields],
      metadata: { ...event.metadata },
    });
  }
}
