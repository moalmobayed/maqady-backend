import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { INVALID_CURSOR_MESSAGE } from '../../common/pagination/pagination.constants';
import { toPage, toPageRequest } from '../../common/pagination/cursor';
import { Clock } from '../../common/time/clock';
import { BookingViews } from './booking-views.service';
import { BookingsRepository } from './bookings.repository';
import type { MyBookingRow, MyBookingsPage, MyBookingsQueryInput } from './types';

/**
 * My Bookings (PRD C10, design §7.4): one page of the signed-in customer's bookings in a tab,
 * with both tabs' counts. Upcoming is every Confirmed booking whose showtime has not ended;
 * Past is Completed, Refunded and Failed. Both are decided now from stored times against the
 * `Clock`, never by a job; Abandoned bookings and live holds appear in neither. Due payments were
 * settled before the route ran (`@SettleFirst('customer')`).
 *
 * A fixed number of queries whatever the page size (CLAUDE.md "No N+1"): the page, the counts,
 * then `BookingViews.ofMany()`'s batches.
 */
@Injectable()
export class MyBookingsService {
  constructor(
    private readonly bookings: BookingsRepository,
    private readonly views: BookingViews,
    private readonly clock: Clock,
  ) {}

  async list(customerId: number, query: MyBookingsQueryInput): Promise<MyBookingsPage> {
    const page = toPageRequest(query, 'instant');
    // An instant list never has a null sort key: a cursor holding one was not ours.
    if (page.after !== null && page.after.sortKey === null) throw invalidCursor();
    const now = this.clock.now();
    // One after the other: inside a transaction they would share one connection.
    const rows = await this.bookings.pageForCustomer(customerId, query.tab, now, page);
    const tabCounts = await this.bookings.tabCountsOfCustomer(customerId, now);
    const shown = rows.slice(0, page.limit);
    const bookings = await this.views.ofMany(shown, now);
    const byId = new Map(bookings.map((booking) => [booking.id, booking]));
    const result = toPage(
      rows,
      page,
      tabCounts[query.tab],
      (row: MyBookingRow) => ({ sortKey: row.showtime_starts_at.toISOString(), id: row.id }),
      (row: MyBookingRow) => {
        const booking = byId.get(row.id);
        if (!booking) throw new AppError('INTERNAL', 'A booking could not be assembled.');
        return booking;
      },
    );
    return { ...result, tabCounts };
  }
}

function invalidCursor(): AppError {
  return new AppError('VALIDATION_FAILED', undefined, {
    fields: [{ field: 'cursor', messages: [INVALID_CURSOR_MESSAGE] }],
  });
}
