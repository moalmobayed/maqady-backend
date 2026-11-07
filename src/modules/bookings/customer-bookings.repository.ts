import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../../common/database/transaction-context';
import { bookingStatusPredicate } from './booking-status.sql';
import type { CustomerBookingStatsRow, StatusAliases } from './types';

/** The numbers query joins each booking (`b`) to its showtime (`s`) for the clock statuses. */
const STATS_ALIASES: StatusAliases = { booking: 'b', showtime: 's' };

/**
 * A customer's bookings as the admin Customers screen and anonymisation read and change them
 * (U15). Every statement names its columns and joins the open transaction.
 */
@Injectable()
export class CustomerBookingsRepository {
  constructor(private readonly db: TransactionContext) {}

  /**
   * The booking numbers of these customers at `now`, one grouped row per customer with at least
   * one paid booking, in one query whatever their number (no N+1). Served by
   * `idx_bookings_customer_id_status_hold_expires_at` (`customer_id`, `status`). A no-show is a
   * Completed booking (`bookingStatusPredicate`, design §7.4) never checked in.
   */
  async statsOf(customerIds: readonly number[], now: Date): Promise<CustomerBookingStatsRow[]> {
    if (customerIds.length === 0) return [];
    const completed = bookingStatusPredicate('completed', STATS_ALIASES, now);
    return this.db
      .executor()('bookings as b')
      .join('showtimes as s', 's.id', 'b.showtime_id')
      .select<CustomerBookingStatsRow[]>(
        'b.customer_id',
        this.db.executor().raw('count(*) AS bookings'),
        this.db.executor().raw('sum(b.total_amount) AS spent'),
        this.db
          .executor()
          .raw(`count(*) FILTER (WHERE ${completed.sql} AND b.checked_in_at IS NULL) AS no_shows`, [
            ...completed.bindings,
          ]),
        this.db.executor().raw('max(b.created_at) AS last_booking_at'),
      )
      .whereIn('b.customer_id', [...customerIds])
      .andWhere('b.status', 'confirmed')
      .groupBy('b.customer_id');
  }

  /**
   * Locks the customer's bookings `FOR UPDATE` in id order (design §7.1 step 5, after the customer
   * row) and returns their ids.
   */
  async lockIdsOfCustomer(customerId: number): Promise<number[]> {
    const rows = await this.db
      .executor()('bookings')
      .select<{ id: number }[]>('id')
      .where({ customer_id: customerId })
      .orderBy('id')
      .forUpdate();
    return rows.map((row) => row.id);
  }

  /**
   * Nulls the contact name, email and phone of these bookings where any is set; returns how many
   * changed. The bookings themselves (status, seats, totals, check-in) stay.
   */
  async clearContacts(ids: readonly number[], now: Date): Promise<number> {
    if (ids.length === 0) return 0;
    return this.db
      .executor()('bookings')
      .update({ contact_name: null, contact_email: null, contact_phone: null, updated_at: now })
      .whereIn('id', [...ids])
      .andWhereRaw(
        '(contact_name IS NOT NULL OR contact_email IS NOT NULL OR contact_phone IS NOT NULL)',
      );
  }
}
