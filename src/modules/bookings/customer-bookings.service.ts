import { Injectable } from '@nestjs/common';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { money } from '../../common/money/money';
import { Clock } from '../../common/time/clock';
import { CustomerBookingsRepository } from './customer-bookings.repository';
import type { ClearedBookingContacts, CustomerBookingStats } from './types';

/**
 * A customer's bookings for the admin Customers screen and anonymisation (U15; PRD A7, design
 * §21), exported to `admin-customers`:
 *
 * - `statsOf()`: Bookings, Spent, No-shows and Last booking of many customers in one query;
 * - `clearContactsOf()`: nulls the contact copied onto their bookings, under the booking lock.
 */
@Injectable()
export class CustomerBookingsService {
  constructor(
    private readonly bookings: CustomerBookingsRepository,
    private readonly transactions: TransactionRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * The numbers of each customer at `now`, keyed by id; a customer with no paid booking gets
   * zeros. One query whatever the number of customers.
   */
  async statsOf(
    customerIds: readonly number[],
    now: Date,
  ): Promise<ReadonlyMap<number, CustomerBookingStats>> {
    const ids = [...new Set(customerIds)];
    const rows = new Map(
      (await this.bookings.statsOf(ids, now)).map((row) => [row.customer_id, row]),
    );
    return new Map(
      ids.map((customerId) => {
        const row = rows.get(customerId);
        return [
          customerId,
          {
            customerId,
            bookings: row?.bookings ?? 0,
            spent: money(row?.spent ?? 0),
            noShows: row?.no_shows ?? 0,
            lastBookingAt: row?.last_booking_at ?? null,
          },
        ];
      }),
    );
  }

  /**
   * Nulls the contact name, email and phone on every booking of the customer (anonymisation,
   * design §21), in the open transaction: their bookings are locked `FOR UPDATE` in id order
   * first (design §7.1 step 5; the caller holds the customer row, step 4).
   */
  async clearContactsOf(customerId: number): Promise<ClearedBookingContacts> {
    return this.transactions.run(async () => {
      const ids = await this.bookings.lockIdsOfCustomer(customerId);
      const cleared = await this.bookings.clearContacts(ids, this.clock.now());
      return { bookings: ids.length, cleared };
    });
  }
}
