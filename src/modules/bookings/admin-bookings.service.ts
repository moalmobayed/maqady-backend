import { Injectable } from '@nestjs/common';
import { AuditReadService } from '../../common/audit/audit-read.service';
import { AppError } from '../../common/errors/app-error';
import { sumMoney } from '../../common/money/money';
import { toPage, toPageRequest } from '../../common/pagination/cursor';
import { INVALID_CURSOR_MESSAGE } from '../../common/pagination/pagination.constants';
import type { Page, PageQueryInput } from '../../common/pagination/types';
import { Clock } from '../../common/time/clock';
import { cinemaDateOf, cinemaDayBounds, subtractFromInstant } from '../../common/time/time';
import { CustomerService } from '../customers/customer.service';
import type { Customer } from '../customers/types';
import { PaymentsService } from '../payments/payments.service';
import { hasTicket } from './booking-assembly';
import { BookingViews } from './booking-views.service';
import { ACTIVITY_LOG_LIMIT, REFUNDED_CARD_DAYS } from './bookings.constants';
import { BookingsRepository } from './bookings.repository';
import { refundableCharges } from './refund-allocation';
import { SettlementService } from './settlement.service';
import { StaffRefsService, withStaff } from './staff-refs.service';
import type {
  AdminBookingDetail,
  AdminBookingFilter,
  AdminBookingListItem,
  AdminBookingSummary,
  AdminCustomerCard,
  BookingContact,
  BookingRow,
} from './types';

/** The Refunded card's 7 days are real time: 7 × 24 hours before now. */
const HOURS_PER_DAY = 24;

/**
 * The admin bookings screen (PRD A6; design §11), for both staff roles: the list with its search
 * and filters, the four summary cards and a booking's detail. Reads only; every due payment is
 * settled first in its own short transaction (`settleAllDue()`, design §7.5 "in a batch before
 * admin lists"), so no screen shows a stale Pending.
 *
 * The list is one query for the page and one for the total, whatever the filters, then
 * `BookingViews.ofMany()` (a fixed number of queries): no N+1.
 */
@Injectable()
export class AdminBookingsService {
  constructor(
    private readonly bookings: BookingsRepository,
    private readonly views: BookingViews,
    private readonly payments: PaymentsService,
    private readonly customers: CustomerService,
    private readonly staffRefs: StaffRefsService,
    private readonly auditRead: AuditReadService,
    private readonly settlement: SettlementService,
    private readonly clock: Clock,
  ) {}

  /** `GET /admin/bookings`: newest first, cursor-paginated, `total` with the same filters. */
  async list(
    filter: AdminBookingFilter,
    query: PageQueryInput,
  ): Promise<Page<AdminBookingListItem>> {
    const request = toPageRequest(query, 'instant');
    if (request.after !== null && request.after.sortKey === null) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fields: [{ field: 'cursor', messages: [INVALID_CURSOR_MESSAGE] }],
      });
    }
    if (
      filter.dateFrom !== undefined &&
      filter.dateTo !== undefined &&
      filter.dateFrom > filter.dateTo
    ) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fields: [{ field: 'dateTo', messages: ['dateTo must be on or after dateFrom'] }],
      });
    }
    await this.settlement.settleAllDue();
    const now = this.clock.now();
    // One after the other: inside a transaction they would share one connection.
    const rows = await this.bookings.pageForAdmin(filter, now, request);
    const total = await this.bookings.countForAdmin(filter, now);
    const pageRows = rows.slice(0, request.limit);
    const bookings = new Map(
      (await this.views.ofMany(pageRows, now)).map((booking) => [booking.id, booking]),
    );
    return toPage(
      rows,
      request,
      total,
      (row) => ({ sortKey: row.created_at.toISOString(), id: row.id }),
      (row) => ({
        booking: bookings.get(row.id)!,
        contact: contactOf(row),
        checkedInAt: row.checked_in_at,
      }),
    );
  }

  /**
   * `GET /admin/bookings/summary`, the four cards (PRD A6): today is the cinema day containing
   * now (06:00 to 06:00 Cairo time, design §8); the Refunded card covers the 7 days before now.
   */
  async summary(): Promise<AdminBookingSummary> {
    await this.settlement.settleAllDue();
    const now = this.clock.now();
    const cinemaDate = cinemaDateOf(now);
    const day = cinemaDayBounds(cinemaDate);
    const today = { from: day.startsAt, to: day.endsAt };
    // One after the other: inside a transaction they would share one connection.
    const todayBookings = await this.bookings.countPaidCreatedBetween(today);
    const moved = await this.payments.moneyMovedBetween(today);
    const refundedIds = await this.bookings.refundedIdsBetween({
      from: subtractFromInstant(now, { hours: REFUNDED_CARD_DAYS * HOURS_PER_DAY }),
      to: now,
    });
    const refundedAmount = await this.payments.refundTotalOf(refundedIds, 'cancellation');
    return {
      cinemaDate,
      serverTime: now,
      todayBookings,
      collectedToday: moved.collected,
      failedPaymentsToday: moved.declinedCount,
      refundedLast7Days: { bookingCount: refundedIds.length, amount: refundedAmount },
    };
  }

  /**
   * `GET /admin/bookings/{ref}`: the booking with its contact, customer card, payments and refunds,
   * what may be done with it now, and its activity log. Unknown: `NOT_FOUND`. Due payments of
   * the booking are settled first (`@SettleFirst('booking')`).
   */
  async detail(reference: string): Promise<AdminBookingDetail> {
    const now = this.clock.now();
    const row = await this.bookings.findByReference(reference);
    if (!row) throw new AppError('NOT_FOUND');
    // One after the other: inside a transaction they would share one connection.
    const booking = await this.views.of(row, now);
    const ledger = await this.payments.ledgerOf([row.id]);
    const customer =
      row.customer_id === null ? null : await this.customers.findById(row.customer_id);
    const activity = await this.auditRead.bookingActivity(row.id, ACTIVITY_LOG_LIMIT);
    const refs = await this.staffRefs.refsOf([
      row.created_by_staff_id,
      row.checked_in_by_staff_id,
      ...ledger.flatMap((entry) => [entry.collectedByStaffId, entry.paidOutByStaffId]),
      ...activity.map((event) => event.actorStaffUserId),
    ]);
    const refundable = sumMoney(
      refundableCharges(ledger).map((charge) => charge.refundable!),
      row.currency,
    );
    const contact = contactOf(row);
    const editable =
      booking.status === 'confirmed' &&
      row.checked_in_at === null &&
      booking.showtime.startsAt.getTime() > now.getTime();
    return {
      booking,
      contact,
      customer: customer ? cardOf(customer) : null,
      soldBy: row.created_by_staff_id === null ? null : (refs.get(row.created_by_staff_id) ?? null),
      checkedInAt: row.checked_in_at,
      checkedInBy:
        row.checked_in_by_staff_id === null ? null : (refs.get(row.checked_in_by_staff_id) ?? null),
      ledger: ledger.map((entry) => withStaff(entry, refs)),
      refundable,
      actions: {
        refund: booking.status === 'confirmed',
        edit: editable,
        resendTickets:
          hasTicket(booking.status) && (contact.email !== null || contact.phone !== null),
      },
      activity: activity.map((event) => ({
        action: event.action,
        occurredAt: event.occurredAt,
        actorKind: event.actorKind,
        staff: event.actorStaffUserId === null ? null : (refs.get(event.actorStaffUserId) ?? null),
        changedFields: event.changedFields,
        metadata: event.metadata,
      })),
    };
  }
}

function contactOf(row: BookingRow): BookingContact {
  return { name: row.contact_name, email: row.contact_email, phone: row.contact_phone };
}

function cardOf(customer: Customer): AdminCustomerCard {
  return {
    id: customer.id,
    fullName: customer.fullName,
    email: customer.email,
    phone: customer.phone,
    status: customer.status,
    anonymised: customer.deletedAt !== null,
  };
}
