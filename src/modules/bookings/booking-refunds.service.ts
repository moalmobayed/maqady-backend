import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { AuditActor, AuditEventInput } from '../../common/audit/types';
import type { StaffPrincipal } from '../../common/auth/types';
import { TransactionContext } from '../../common/database/transaction-context';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { formatMoneyDisplay, money, sumMoney } from '../../common/money/money';
import type { Money } from '../../common/money/types';
import { Clock } from '../../common/time/clock';
import { formatCairoDisplay } from '../../common/time/time';
import { MessagingService } from '../messaging/messaging.service';
import type { QueueMessageInput } from '../messaging/types';
import { PaymentsService } from '../payments/payments.service';
import type { LedgerEntry } from '../payments/types';
import { SeatClaimService } from '../seating/seat-claim.service';
import { SeatEventPublisher } from '../seating/seat-event.publisher';
import { ShowtimeReadService } from '../showtimes/showtime-read.service';
import { BookingReadService } from './booking-read.service';
import { BookingShowtimeService } from './booking-showtime.service';
import { bookingStatusOf } from './booking-status.sql';
import {
  BOOKING_ENTITY,
  BOOKING_REFUNDED_ACTION,
  PAYMENT_ENTITY,
  PAYOUT_ACTION,
} from './bookings.constants';
import { BookingsRepository } from './bookings.repository';
import { refundEverything } from './refund-allocation';
import { StaffRefsService } from './staff-refs.service';
import { bookingRefundedTemplate } from './templates/booking-refunded.template';
import type {
  AdminLedgerEntry,
  BookingRefundedParams,
  BookingRefundResult,
  BookingRow,
  BookingSeatRow,
  BookingShowtime,
  RefundContext,
  RefundedBooking,
} from './types';

/**
 * Cancel & refund, and paying out counter refunds (design §7.7; PRD "Cancellations, refunds and
 * edits" 2–3). Admins only (the controller's `@Admin()`).
 *
 * A booking is always refunded in full, **per charge**: each succeeded charge gets a refund for
 * what is left of it, on its own rail. Card and wallet charges go back through the payment
 * provider (`succeeded` at once, our key `<reference>-r<n>`); cash and card-terminal charges get a
 * `pending` refund that an admin records as paid out at the counter.
 *
 * Locks follow design §7.1, steps 5 then 6: the booking `FOR UPDATE`, then its claims in seat
 * order. A second request, or a race with an edit or a showtime cancellation, waits on the booking
 * lock and then finds the booking refunded, so each charge is refunded exactly once.
 */
@Injectable()
export class BookingRefundsService {
  constructor(
    private readonly bookings: BookingsRepository,
    private readonly reads: BookingReadService,
    private readonly showtimes: ShowtimeReadService,
    private readonly headers: BookingShowtimeService,
    private readonly payments: PaymentsService,
    private readonly seatClaims: SeatClaimService,
    private readonly events: SeatEventPublisher,
    private readonly messaging: MessagingService,
    private readonly staffRefs: StaffRefsService,
    private readonly audit: AuditService,
    private readonly transactions: TransactionRepository,
    private readonly context: TransactionContext,
    private readonly clock: Clock,
  ) {}

  /**
   * `POST /admin/bookings/{ref}/refunds`: cancels a confirmed booking whose showtime has not
   * ended and refunds it in full (design §7.7). Unknown: `NOT_FOUND`; any other status (judged
   * under the lock): `BOOKING_NOT_REFUNDABLE { status }`, writing nothing.
   */
  async cancelAndRefund(staff: StaffPrincipal, reference: string): Promise<BookingRefundResult> {
    return this.transactions.run(async () => {
      const now = this.clock.now();
      const found = await this.bookings.findByReference(reference);
      if (!found) throw new AppError('NOT_FOUND');
      const [locked] = await this.bookings.lockForUpdate([found.id]);
      if (!locked) throw new AppError('NOT_FOUND');
      const view = (await this.showtimes.findByIds([locked.showtime_id])).get(locked.showtime_id);
      if (!view) {
        throw new AppError('INTERNAL', 'A booking references a showtime that does not exist.');
      }
      const status = bookingStatusOf(
        {
          status: locked.status,
          holdExpiresAt: locked.hold_expires_at,
          hasDeclinedPayment: locked.has_declined_payment,
          showtimeEndsAt: view.endsAt,
        },
        now,
      );
      if (status !== 'confirmed') {
        throw new AppError('BOOKING_NOT_REFUNDABLE', undefined, { status });
      }
      const [refunded] = await this.refundLocked([locked], {
        actor: { kind: 'staff', id: staff.id },
        now,
        reason: 'admin_cancel',
        notify: true,
      });
      return {
        refunds: refunded?.refunds ?? [],
        booking: await this.reads.getForStaff(reference),
      };
    });
  }

  /**
   * Refunds these bookings in full (design §7.7), in the open transaction, which already holds
   * them `FOR UPDATE` (§7.1 step 5) and has checked that each is stored `confirmed`. Locks their
   * claims in seat order (step 6), refunds every charge's remainder on its rail in one insert,
   * marks the bookings `refunded`, deletes their claims (`seat.released` after commit), audits
   * `payment.refunded` per refund and `booking.refunded` per booking and, with `notify`, queues
   * the refund email to each contact email. A fixed number of statements whatever the batch
   * (provider calls aside: one per online charge). Exported for the showtime cancellation.
   */
  async refundLocked(
    rows: readonly BookingRow[],
    context: RefundContext,
  ): Promise<readonly RefundedBooking[]> {
    if (!this.context.isActive()) {
      throw new AppError('INTERNAL', 'Bookings are refunded inside a transaction.');
    }
    if (rows.some((row) => row.status !== 'confirmed')) {
      throw new AppError('INTERNAL', 'Only confirmed bookings are refunded.');
    }
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const seats = await this.bookings.seatsOf(ids);
    const claims = rows.map((row) => ({
      showtimeId: row.showtime_id,
      bookingId: row.id,
      labels: labelsOf(seats, row.id),
    }));
    await this.seatClaims.lockFor(claims);

    const ledger = await this.payments.ledgerOf(ids);
    const items = rows.flatMap((row) =>
      refundEverything(ledger.filter((entry) => entry.bookingId === row.id)).map((planned) => ({
        charge: planned.charge,
        amount: planned.amount,
        reference: row.reference,
      })),
    );
    const refunds = await this.payments.refund(items, 'cancellation');
    await this.bookings.markRefunded(ids, context.now);
    const freed = await this.seatClaims.deleteOwn(claims);

    const byBooking = new Map(ids.map((id) => [id, [] as LedgerEntry[]]));
    for (const refund of refunds) byBooking.get(refund.bookingId)?.push(refund);
    await this.audit.recordMany([
      ...refunds.map((refund) => refundEvent(context.actor, refund)),
      ...rows.map((row): AuditEventInput => ({
        actor: context.actor,
        action: BOOKING_REFUNDED_ACTION,
        entity: { type: BOOKING_ENTITY, id: row.id },
        bookingId: row.id,
        metadata: {
          showtimeId: row.showtime_id,
          reason: context.reason,
          seatCount: row.seat_count,
          amount: totalOf(byBooking.get(row.id) ?? [], row).amount,
        },
      })),
    ]);
    if (context.notify) await this.queueRefundEmails(rows, byBooking);
    for (const { showtimeId, labels } of freed) {
      await this.events.publishAfterCommit({ type: 'seat.released', showtimeId, labels });
    }
    return rows.map((row) => ({ row, refunds: byBooking.get(row.id) ?? [] }));
  }

  /**
   * `POST /admin/refunds/{id}/payouts`: records a pending counter refund as paid out by this
   * admin (design §7.7). The refund's booking is locked first (payments are written only under
   * it), then one conditional update moves it from `pending` to `succeeded`. Unknown, or not a
   * refund: `NOT_FOUND`; not pending (online, or already paid out): `REFUND_NOT_PENDING`.
   */
  async payOut(staff: StaffPrincipal, refundId: number): Promise<AdminLedgerEntry> {
    return this.transactions.run(async () => {
      const found = await this.payments.findLedgerEntry(refundId);
      if (!found || found.kind !== 'refund') throw new AppError('NOT_FOUND');
      await this.bookings.lockForUpdate([found.bookingId]);
      const paid = await this.payments.markPaidOut(refundId, staff.id);
      if (!paid) {
        const now = await this.payments.findLedgerEntry(refundId);
        throw new AppError('REFUND_NOT_PENDING', undefined, {
          status: now?.status ?? found.status,
        });
      }
      await this.audit.record({
        actor: { kind: 'staff', id: staff.id },
        action: PAYOUT_ACTION,
        entity: { type: PAYMENT_ENTITY, id: paid.id },
        bookingId: paid.bookingId,
        metadata: { method: paid.method, purpose: paid.purpose, amount: paid.amount.amount },
      });
      const [entry] = await this.staffRefs.ledgerWithStaff([paid]);
      return entry!;
    });
  }

  /** The refund email of each refunded booking with a contact email, in one insert. */
  private async queueRefundEmails(
    rows: readonly BookingRow[],
    refunds: ReadonlyMap<number, readonly LedgerEntry[]>,
  ): Promise<void> {
    const recipients = rows.filter((row) => row.contact_email !== null);
    if (recipients.length === 0) return;
    const headers = await this.headers.headersOf(recipients.map((row) => row.showtime_id));
    const inputs = recipients.map((row): QueueMessageInput<BookingRefundedParams> => ({
      template: bookingRefundedTemplate,
      recipient: row.contact_email!,
      params: refundParams(row, headerOf(headers, row), refunds.get(row.id) ?? []),
      related: {
        bookingId: row.id,
        ...(row.customer_id === null ? {} : { customerId: row.customer_id }),
      },
    }));
    await this.messaging.queueMany(inputs);
  }
}

function labelsOf(seats: readonly BookingSeatRow[], bookingId: number): string[] {
  return seats.filter((seat) => seat.booking_id === bookingId).map((seat) => seat.seat_label);
}

function headerOf(headers: ReadonlyMap<number, BookingShowtime>, row: BookingRow): BookingShowtime {
  const header = headers.get(row.showtime_id);
  if (!header)
    throw new AppError('INTERNAL', 'A booking references a showtime that does not exist.');
  return header;
}

/** What a booking's refunds give back in all. */
function totalOf(refunds: readonly LedgerEntry[], row: BookingRow): Money {
  return sumMoney(
    refunds.map((refund) => refund.amount),
    row.currency,
  );
}

/** The online and counter parts of a booking's refunds, as messages show them. */
export function refundSplitOf(
  refunds: readonly LedgerEntry[],
  row: BookingRow,
): { amount: string; onlineAmount: string | null; counterAmount: string | null } {
  const online = refunds.filter((refund) => refund.method === 'card' || refund.method === 'wallet');
  const counter = refunds.filter((refund) => !online.includes(refund));
  const display = (part: readonly LedgerEntry[]) =>
    part.length === 0 ? null : formatMoneyDisplay(totalOf(part, row));
  return {
    amount: formatMoneyDisplay(
      refunds.length === 0 ? money(0, row.currency) : totalOf(refunds, row),
    ),
    onlineAmount: display(online),
    counterAmount: display(counter),
  };
}

function refundParams(
  row: BookingRow,
  header: BookingShowtime,
  refunds: readonly LedgerEntry[],
): BookingRefundedParams {
  return {
    reference: row.reference,
    customerName: row.contact_name,
    movieTitle: header.movie.title,
    theaterName: header.theater.name,
    startsAt: formatCairoDisplay(header.startsAt),
    ...refundSplitOf(refunds, row),
  };
}

/** `payment.refunded`, as the actor recorded it, with its rail and purpose. */
export function refundEvent(actor: AuditActor, refund: LedgerEntry): AuditEventInput {
  return {
    actor,
    action: 'payment.refunded',
    entity: { type: PAYMENT_ENTITY, id: refund.id },
    bookingId: refund.bookingId,
    metadata: {
      method: refund.method,
      purpose: refund.purpose,
      status: refund.status,
      amount: refund.amount.amount,
      refundOfPaymentId: refund.refundOfPaymentId,
    },
  };
}
