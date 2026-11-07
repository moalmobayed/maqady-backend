import { Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import type { PageRequest } from '../../common/pagination/types';
import type { BookingNoteRow, NewBookingNoteRow } from './types';

const NOTE_COLUMNS = ['id', 'booking_id', 'staff_user_id', 'body', 'created_at'] as const;

/**
 * `booking_notes` (design §6.2, U14): staff notes on a booking. Only the admin routes read it;
 * no customer route does. Served by `idx_booking_notes_booking_id_created_at`.
 */
@Injectable()
export class BookingNotesRepository {
  constructor(private readonly db: TransactionContext) {}

  async insert(row: NewBookingNoteRow): Promise<BookingNoteRow> {
    const [inserted] = await this.notes().insert(row).returning<BookingNoteRow[]>(NOTE_COLUMNS);
    if (!inserted) throw new AppError('INTERNAL', 'The note insert returned no row.');
    return inserted;
  }

  /**
   * One page of a booking's notes, newest first, `limit + 1` rows; the cursor's sort key is the
   * note's `created_at` as an ISO instant, bound as a `Date`.
   */
  async pageOf(bookingId: number, page: PageRequest): Promise<BookingNoteRow[]> {
    const query = this.notes()
      .select<BookingNoteRow[]>(NOTE_COLUMNS)
      .where({ booking_id: bookingId })
      .orderBy([
        { column: 'created_at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .limit(page.limit + 1);
    if (page.after) {
      query.andWhereRaw('(created_at, id) < (?, ?)', [
        new Date(String(page.after.sortKey)),
        page.after.id,
      ]);
    }
    return query;
  }

  async countOf(bookingId: number): Promise<number> {
    const row = await this.notes()
      .where({ booking_id: bookingId })
      .count<{ count: number }[]>({ count: 'id' })
      .first();
    return row?.count ?? 0;
  }

  /**
   * Deletes the notes on every booking of a customer, in one statement (anonymisation, U15,
   * design §21); returns how many went.
   */
  async deleteForCustomer(customerId: number): Promise<number> {
    return this.notes()
      .whereIn(
        'booking_id',
        this.db.executor()('bookings').select('id').where({ customer_id: customerId }),
      )
      .delete();
  }

  private notes(): Knex.QueryBuilder {
    return this.db.executor()('booking_notes');
  }
}
