import { Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import type { PageRequest } from '../../common/pagination/types';
import { bookingStatusPredicate } from './booking-status.sql';
import { tabPredicate } from './my-bookings.sql';
import type {
  BookingOwnerColumns,
  BookingRow,
  BookingSeatRow,
  CheckInTarget,
  CounterCustomerColumns,
  MyBookingRow,
  MyBookingsTab,
  NewBookingRow,
  SqlPredicate,
  StatusAliases,
  TabCountsRow,
  TicketHolderRow,
} from './types';

const BOOKING_COLUMNS = [
  'id',
  'reference',
  'showtime_id',
  'status',
  'channel',
  'customer_id',
  'created_by_staff_id',
  'hold_token_hash',
  'hold_expires_at',
  'has_declined_payment',
  'seat_count',
  'total_amount',
  'currency',
  'contact_name',
  'contact_email',
  'contact_phone',
  'confirmed_at',
  'refunded_at',
  'qr_version',
  'checked_in_at',
  'checked_in_by_staff_id',
  'created_at',
  'updated_at',
] as const;

const SEAT_COLUMNS = [
  'booking_id',
  'seat_label',
  'row_label',
  'seat_number',
  'zone',
  'price',
  'is_wheelchair',
] as const;

/** My Bookings joins each booking to its showtime under these aliases (design §5, §7.4). */
const MY_BOOKINGS_ALIASES: StatusAliases = { booking: 'b', showtime: 's' };

/** A live hold at `now`, on the unaliased `bookings` table (design §7.4). */
function liveHold(now: Date): SqlPredicate {
  return bookingStatusPredicate('held', { booking: 'bookings', showtime: 'showtimes' }, now);
}

/**
 * `bookings` and `booking_seats` (design §6.2). Every method runs on the current executor, so it
 * joins the request transaction; reads of many bookings are one query (`whereIn`).
 */
@Injectable()
export class BookingsRepository {
  constructor(private readonly db: TransactionContext) {}

  /**
   * Inserts the booking under `reference` unless that reference is taken (`ON CONFLICT
   * (reference) DO NOTHING`, so a collision never aborts the transaction, design §7.9); returns
   * the new row, or undefined on a collision.
   */
  async insertUnlessReferenceTaken(
    row: NewBookingRow,
    reference: string,
  ): Promise<BookingRow | undefined> {
    const [inserted] = await this.bookings()
      .insert({ ...row, reference })
      .onConflict('reference')
      .ignore()
      .returning<BookingRow[]>(BOOKING_COLUMNS);
    return inserted;
  }

  /** A booking's seats, in one multi-row insert. */
  async insertSeats(rows: readonly BookingSeatRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .executor()('booking_seats')
      .insert([...rows]);
  }

  async findByReference(reference: string): Promise<BookingRow | undefined> {
    return this.bookings().select<BookingRow[]>(BOOKING_COLUMNS).where({ reference }).first();
  }

  /** The ids of the customer's live online holds at `now`, in id order. */
  async liveOnlineHoldIdsOfCustomer(customerId: number, now: Date): Promise<number[]> {
    const live = liveHold(now);
    const rows = await this.bookings()
      .select<{ id: number }[]>('id')
      .where({ customer_id: customerId, channel: 'online' })
      .andWhereRaw(live.sql, [...live.bindings])
      .orderBy('id');
    return rows.map((row) => row.id);
  }

  /**
   * The ids of the staff member's live counter holds at `now`, in id order (at most one is
   * expected, U13), through `idx_bookings_created_by_staff_id_status_hold_expires_at`.
   */
  async liveCounterHoldIdsOfStaff(staffUserId: number, now: Date): Promise<number[]> {
    const live = liveHold(now);
    const rows = await this.bookings()
      .select<{ id: number }[]>('id')
      .where({ created_by_staff_id: staffUserId, channel: 'counter' })
      .andWhereRaw(live.sql, [...live.bindings])
      .orderBy('id');
    return rows.map((row) => row.id);
  }

  /** The id of the live, unowned hold stored under this code hash at `now`, if any. */
  async liveUnownedHoldIdByCodeHash(hash: string, now: Date): Promise<number | undefined> {
    const live = liveHold(now);
    const row = await this.bookings()
      .select<{ id: number }[]>('id')
      .where({ hold_token_hash: hash })
      .whereNull('customer_id')
      .andWhereRaw(live.sql, [...live.bindings])
      .first();
    return row?.id;
  }

  /**
   * Locks these bookings `FOR UPDATE` in id order (design §7.1 step 5) and returns them as they
   * are once locked.
   */
  async lockForUpdate(ids: readonly number[]): Promise<BookingRow[]> {
    if (ids.length === 0) return [];
    return this.bookings()
      .select<BookingRow[]>(BOOKING_COLUMNS)
      .whereIn('id', [...new Set(ids)])
      .orderBy('id')
      .forUpdate();
  }

  /** The seats of these bookings, by booking and then label in claim order. */
  async seatsOf(bookingIds: readonly number[]): Promise<BookingSeatRow[]> {
    if (bookingIds.length === 0) return [];
    return this.db
      .executor()('booking_seats')
      .select<BookingSeatRow[]>(SEAT_COLUMNS)
      .whereIn('booking_id', [...new Set(bookingIds)])
      .orderByRaw('booking_id, seat_label COLLATE "C"');
  }

  /** Ends these holds at `now`: from then on they read as Abandoned (or Failed after a decline). */
  async expireHolds(ids: readonly number[], now: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.bookings()
      .whereIn('id', [...ids])
      .update({ hold_expires_at: now, updated_at: now });
  }

  /** Gives a guest hold its owner and their contact, and clears the hold code. */
  async assignOwner(id: number, columns: BookingOwnerColumns): Promise<BookingRow> {
    const [updated] = await this.bookings()
      .where({ id })
      .update(columns)
      .returning<BookingRow[]>(BOOKING_COLUMNS);
    if (!updated) throw new AppError('INTERNAL', 'The booking update returned no row.');
    return updated;
  }

  /** Gives a counter hold the customer and contact of its sale (U13); the row as it now is. */
  async setCounterCustomer(id: number, columns: CounterCustomerColumns): Promise<BookingRow> {
    const [updated] = await this.bookings()
      .where({ id, channel: 'counter', status: 'held' })
      .update(columns)
      .returning<BookingRow[]>(BOOKING_COLUMNS);
    if (!updated) throw new AppError('INTERNAL', 'The counter hold to sell is no longer held.');
    return updated;
  }

  /**
   * Admits a confirmed booking at the entrance (design §7.9), atomically: only while it is still
   * `confirmed`, never admitted, on the showtime the scan judged (an edit may move it, U14) and,
   * for a QR code, of the presented QR version. Two scans of one ticket serialize on the row; the
   * second re-checks the condition after the first commits and changes nothing. Returns the
   * admission time, or undefined when nothing changed.
   */
  async checkIn(
    presented: CheckInTarget,
    staffUserId: number,
    now: Date,
  ): Promise<Date | undefined> {
    const query = this.bookings()
      .where({ id: presented.id, showtime_id: presented.showtimeId, status: 'confirmed' })
      .whereNull('checked_in_at');
    if (presented.qrVersion !== null) query.andWhere({ qr_version: presented.qrVersion });
    const [row] = await query
      .update({ checked_in_at: now, checked_in_by_staff_id: staffUserId, updated_at: now })
      .returning<{ checked_in_at: Date }[]>('checked_in_at');
    return row?.checked_in_at;
  }

  /** These bookings in any status, in id order; unknown ids are absent. */
  async findByIds(ids: readonly number[]): Promise<BookingRow[]> {
    if (ids.length === 0) return [];
    return this.bookings()
      .select<BookingRow[]>(BOOKING_COLUMNS)
      .whereIn('id', [...new Set(ids)])
      .orderBy('id');
  }

  /**
   * Confirms these held bookings (design §7.5 step 6): `confirmed`, `confirmed_at`, the first QR
   * version. Only rows still `held` change; returns them.
   */
  async confirm(ids: readonly number[], now: Date): Promise<BookingRow[]> {
    if (ids.length === 0) return [];
    return this.bookings()
      .whereIn('id', [...new Set(ids)])
      .where({ status: 'held' })
      .update({ status: 'confirmed', confirmed_at: now, qr_version: 1, updated_at: now })
      .returning<BookingRow[]>(BOOKING_COLUMNS);
  }

  /** Records that these holds had a declined payment: once they end they read as Failed. */
  async markDeclined(ids: readonly number[], now: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.bookings()
      .whereIn('id', [...new Set(ids)])
      .update({ has_declined_payment: true, updated_at: now });
  }

  /** Moves a hold's end to `until` (a processing payment keeps its seats, design §7.5). */
  async extendHold(id: number, until: Date, now: Date): Promise<BookingRow> {
    const [updated] = await this.bookings()
      .where({ id, status: 'held' })
      .update({ hold_expires_at: until, updated_at: now })
      .returning<BookingRow[]>(BOOKING_COLUMNS);
    if (!updated) throw new AppError('INTERNAL', 'The hold to extend is no longer held.');
    return updated;
  }

  /**
   * Refunds these bookings: `refunded` at `now`. A hold refunded at once by settlement (design
   * §7.5) never had a confirmation, so it is given one at the same instant and the first QR
   * version, as the lifecycle CHECK of a refunded booking requires; its QR code was never issued.
   */
  async markRefunded(ids: readonly number[], now: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.bookings()
      .whereIn('id', [...new Set(ids)])
      .whereIn('status', ['held', 'confirmed'])
      .update({
        status: 'refunded',
        confirmed_at: this.db.executor().raw('COALESCE(confirmed_at, ?)', [now]),
        refunded_at: now,
        qr_version: this.db.executor().raw('COALESCE(qr_version, 1)'),
        updated_at: now,
      });
  }

  /** The contacts of a showtime's confirmed bookings, in id order (U7's move notifications). */
  async ticketHoldersOf(showtimeId: number): Promise<TicketHolderRow[]> {
    return this.bookings()
      .select<TicketHolderRow[]>('id', 'reference', 'customer_id', 'contact_email', 'contact_phone')
      .where({ showtime_id: showtimeId, status: 'confirmed' })
      .orderBy('id');
  }

  /**
   * One page of a customer's bookings in a My Bookings tab at `now` (PRD C10), `limit + 1` rows:
   * Upcoming soonest show first, Past most recent show first, ties by id the same way. Joined to
   * `showtimes` for the clock-derived status and the keyset (design §5: bookings reads showtimes
   * through its own SQL joins). The customer's rows come from
   * `idx_bookings_customer_id_status_hold_expires_at`. The cursor's sort key is the show's start as
   * an ISO instant, bound as a `Date`.
   */
  async pageForCustomer(
    customerId: number,
    tab: MyBookingsTab,
    now: Date,
    page: PageRequest,
  ): Promise<MyBookingRow[]> {
    const predicate = tabPredicate(tab, MY_BOOKINGS_ALIASES, now);
    const order = tab === 'upcoming' ? 'asc' : 'desc';
    const query = this.customerBookings(customerId)
      .select<MyBookingRow[]>([
        ...BOOKING_COLUMNS.map((column) => `b.${column}`),
        's.starts_at as showtime_starts_at',
      ])
      .andWhereRaw(predicate.sql, [...predicate.bindings])
      .orderBy([
        { column: 's.starts_at', order },
        { column: 'b.id', order },
      ])
      .limit(page.limit + 1);
    if (page.after) {
      query.andWhereRaw(`(s.starts_at, b.id) ${order === 'asc' ? '>' : '<'} (?, ?)`, [
        new Date(String(page.after.sortKey)),
        page.after.id,
      ]);
    }
    return query;
  }

  /** How many of the customer's bookings each My Bookings tab has at `now`, in one query. */
  async tabCountsOfCustomer(customerId: number, now: Date): Promise<TabCountsRow> {
    const upcoming = tabPredicate('upcoming', MY_BOOKINGS_ALIASES, now);
    const past = tabPredicate('past', MY_BOOKINGS_ALIASES, now);
    const row = await this.customerBookings(customerId)
      .select<TabCountsRow[]>(
        this.db
          .executor()
          .raw(`COUNT(*) FILTER (WHERE ${upcoming.sql})::int AS upcoming`, [...upcoming.bindings]),
        this.db
          .executor()
          .raw(`COUNT(*) FILTER (WHERE ${past.sql})::int AS past`, [...past.bindings]),
      )
      .first();
    return { upcoming: row?.upcoming ?? 0, past: row?.past ?? 0 };
  }

  /**
   * How many of the customer's bookings are stored `confirmed`: Confirmed and Completed, the
   * Profile's booking count (PRD C12). Served by `idx_bookings_customer_id_status_hold_expires_at`.
   */
  async countConfirmedOfCustomer(customerId: number): Promise<number> {
    const row = await this.bookings()
      .where({ customer_id: customerId, status: 'confirmed' })
      .count<{ count: number }[]>({ count: 'id' })
      .first();
    return row?.count ?? 0;
  }

  private customerBookings(customerId: number): Knex.QueryBuilder {
    return this.db
      .executor()({ b: 'bookings' })
      .join({ s: 'showtimes' }, 's.id', 'b.showtime_id')
      .where('b.customer_id', customerId);
  }

  private bookings(): Knex.QueryBuilder {
    return this.db.executor()('bookings');
  }
}
