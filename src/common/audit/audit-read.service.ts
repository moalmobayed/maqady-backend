import { Injectable } from '@nestjs/common';
import type { PageRequest } from '../pagination/types';
import { AuditReadRepository } from './audit-read.repository';
import type { AuditEventPage, BookingEventsFilter } from './types';

/**
 * The activity log's read side for a booking's History (design §13.5, U12): the events of the
 * booking and of its showtime that the filter names, oldest first, one page and the total.
 * Which actions a customer may see, and their labels, are the bookings module's decision; this
 * returns only when and what happened, never who did it or the metadata.
 */
@Injectable()
export class AuditReadService {
  constructor(private readonly repository: AuditReadRepository) {}

  async bookingEvents(filter: BookingEventsFilter, page: PageRequest): Promise<AuditEventPage> {
    // One after the other: inside a transaction they would share one connection.
    const rows = await this.repository.bookingEvents(filter, page);
    const total = await this.repository.countBookingEvents(filter);
    return {
      rows: rows.map((row) => ({ id: row.id, occurredAt: row.occurred_at, action: row.action })),
      total,
    };
  }
}
