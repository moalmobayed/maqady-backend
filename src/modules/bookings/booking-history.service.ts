import { Injectable } from '@nestjs/common';
import { AuditReadService } from '../../common/audit/audit-read.service';
import type { BookingEventsFilter } from '../../common/audit/types';
import { AppError } from '../../common/errors/app-error';
import { INVALID_CURSOR_MESSAGE } from '../../common/pagination/pagination.constants';
import { toPage, toPageRequest } from '../../common/pagination/cursor';
import type { Page, PageQueryInput, PageRequest } from '../../common/pagination/types';
import { toHistoryEvent } from './booking-history';
import { HISTORY_BOOKING_ACTIONS, HISTORY_SHOWTIME_ACTIONS } from './bookings.constants';
import { BookingsRepository } from './bookings.repository';
import type { BookingHistoryEvent, BookingRow } from './types';

/**
 * A booking's History (PRD C11, design §13.5): the customer-visible subset of its audit events,
 * oldest first, mapped to friendly labels. The booking's own events with a History action, plus
 * the moves of its showtime while it held a ticket (from `confirmed_at`, until `refunded_at` once
 * refunded). Every other action, the actor and the metadata stay internal.
 *
 * `list()` is the owner's read: another customer's booking, or an unknown reference, is
 * `NOT_FOUND` before any audit read. `ofBooking()` skips that check, for staff reads (U14).
 */
@Injectable()
export class BookingHistoryService {
  constructor(
    private readonly bookings: BookingsRepository,
    private readonly audit: AuditReadService,
  ) {}

  async list(
    reference: string,
    customerId: number,
    query: PageQueryInput,
  ): Promise<Page<BookingHistoryEvent>> {
    const request = pageRequestOf(query);
    const row = await this.bookings.findByReference(reference);
    if (!row || row.customer_id !== customerId) throw new AppError('NOT_FOUND');
    return this.page(row, request);
  }

  /** The History of a booking already read, whoever owns it (staff reads, U14). */
  async ofBooking(row: BookingRow, query: PageQueryInput): Promise<Page<BookingHistoryEvent>> {
    return this.page(row, pageRequestOf(query));
  }

  private async page(row: BookingRow, request: PageRequest): Promise<Page<BookingHistoryEvent>> {
    const { rows, total } = await this.audit.bookingEvents(historyFilterOf(row), request);
    return toPage(
      rows,
      request,
      total,
      (event) => ({ sortKey: event.occurredAt.toISOString(), id: event.id }),
      (event) => {
        const mapped = toHistoryEvent(event);
        // The filter names only History actions, so every row maps.
        if (!mapped) throw new AppError('INTERNAL', 'A History event has no label.');
        return mapped;
      },
    );
  }
}

/**
 * What a booking's History reads: its own History actions and, once it was confirmed, the moves
 * of its showtime from `confirmed_at` (until `refunded_at` once refunded).
 */
export function historyFilterOf(row: BookingRow): BookingEventsFilter {
  return {
    bookingId: row.id,
    bookingActions: Object.keys(HISTORY_BOOKING_ACTIONS),
    showtime:
      row.confirmed_at === null
        ? null
        : {
            id: row.showtime_id,
            actions: Object.keys(HISTORY_SHOWTIME_ACTIONS),
            from: row.confirmed_at,
            until: row.refunded_at,
          },
  };
}

/** The page request of an instant-keyed list; a cursor with a null sort key was not ours. */
function pageRequestOf(query: PageQueryInput): PageRequest {
  const request = toPageRequest(query, 'instant');
  if (request.after !== null && request.after.sortKey === null) {
    throw new AppError('VALIDATION_FAILED', undefined, {
      fields: [{ field: 'cursor', messages: [INVALID_CURSOR_MESSAGE] }],
    });
  }
  return request;
}
