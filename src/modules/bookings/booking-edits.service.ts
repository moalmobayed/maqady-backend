import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { AuditActor } from '../../common/audit/types';
import type { StaffPrincipal } from '../../common/auth/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { money } from '../../common/money/money';
import { Clock } from '../../common/time/clock';
import { layoutSeats } from '../halls/hall-layout';
import { HallReadService } from '../halls/hall-read.service';
import type { HallSeat } from '../halls/types';
import { PaymentsService } from '../payments/payments.service';
import type { LedgerEntry } from '../payments/types';
import { sortedLabels } from '../seating/claim-plan';
import { SeatAvailabilityService } from '../seating/seat-availability.service';
import { SeatClaimService } from '../seating/seat-claim.service';
import { SeatEventPublisher } from '../seating/seat-event.publisher';
import { notBookableReason } from './bookability';
import { refundEvent } from './booking-refunds.service';
import { BookingShowtimeService } from './booking-showtime.service';
import { bookingStatusOf } from './booking-status.sql';
import { BookingViews } from './booking-views.service';
import { BOOKING_EDITED_ACTION, BOOKING_ENTITY, PAYMENT_ENTITY } from './bookings.constants';
import { BookingsRepository } from './bookings.repository';
import { planEdit } from './edit-plan';
import { TicketsService } from './tickets.service';
import type {
  BookingRow,
  BookingSeat,
  BookingSeatRow,
  EditBookingInput,
  EditPlan,
  EditPreview,
  EditResult,
  ShowtimeContext,
} from './types';

/**
 * Booking edits (design §7.8; PRD "Cancellations, refunds and edits" 5–6, A6 "Edit booking"),
 * admins only: another showtime of the same movie, other seats, or other contact details, with a
 * required reason. The preview and the edit share `planEdit()`, so what the preview shows is what
 * the edit applies.
 *
 * Only a confirmed booking whose showtime has not started and that nobody has checked in can be
 * edited (`BOOKING_NOT_EDITABLE`). The edit runs in one transaction under the lock order (§7.1):
 * the current and target showtimes `FOR SHARE` in id order, the target hall `FOR SHARE`, the
 * booking `FOR UPDATE`, then the claims of its current seats and of the target seats in
 * (`showtime_id`, label) order. Its old claims are deleted, the booking moved, its seats rebuilt,
 * the new seats claimed sold with the §7.2 upsert; one seat taken rolls everything back
 * (`SEAT_TAKEN`). A lower total is refunded across the charges newest first, each on its rail; a
 * higher one is taken at the counter in the same request. The QR version goes up, so the old QR
 * code stops working.
 */
@Injectable()
export class BookingEditsService {
  constructor(
    private readonly bookings: BookingsRepository,
    private readonly showtimes: BookingShowtimeService,
    private readonly halls: HallReadService,
    private readonly payments: PaymentsService,
    private readonly seatClaims: SeatClaimService,
    private readonly availability: SeatAvailabilityService,
    private readonly events: SeatEventPublisher,
    private readonly tickets: TicketsService,
    private readonly views: BookingViews,
    private readonly audit: AuditService,
    private readonly transactions: TransactionRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * `POST /admin/bookings/{ref}/edit-previews`: the edit as it would be applied now, without
   * locks and without writing anything. The seats someone else holds now are listed in
   * `unavailableSeats` (the edit would answer `SEAT_TAKEN`); `payment` is not checked here.
   */
  async preview(reference: string, input: EditBookingInput): Promise<EditPreview> {
    const now = this.clock.now();
    const row = await this.bookings.findByReference(reference);
    if (!row) throw new AppError('NOT_FOUND');
    const targetId = input.showtimeId ?? row.showtime_id;
    // One after the other: inside a transaction they would share one connection.
    const current = await this.showtimes.anyContext(row.showtime_id);
    const target =
      targetId === row.showtime_id ? current : await this.showtimes.anyContext(targetId);
    const seats = await this.bookings.seatsOf([row.id]);
    const ledger = await this.payments.ledgerOf([row.id]);
    const plan = await this.planFor(row, seats, current, target, input, ledger, now);

    const taken = await this.availability.snapshot(targetId);
    const own = new Set(targetId === row.showtime_id ? seats.map((seat) => seat.seat_label) : []);
    const wanted = new Set(plan.seats.map((seat) => seat.label));
    return {
      current: {
        showtime: current!.header,
        seats: seats.map((seat) => toBookingSeat(seat, row)),
        total: plan.previousTotal,
      },
      proposed: { showtime: target!.header, seats: plan.seats, total: plan.total },
      difference: plan.difference,
      refunds: plan.refunds,
      changedFields: plan.changedFields,
      unavailableSeats: sortedLabels(
        taken.seats
          .map((seat) => seat.label)
          .filter((label) => wanted.has(label) && !own.has(label)),
      ),
    };
  }

  /** `POST /admin/bookings/{ref}/edits`: applies the edit in one transaction (design §7.8). */
  async apply(
    staff: StaffPrincipal,
    reference: string,
    input: EditBookingInput,
  ): Promise<EditResult> {
    return this.transactions.run(async () => {
      const now = this.clock.now();
      const found = await this.bookings.findByReference(reference);
      if (!found) throw new AppError('NOT_FOUND');
      const targetId = input.showtimeId ?? found.showtime_id;

      // §7.1 step 2: both showtimes FOR SHARE, in id order.
      const contexts = new Map<number, ShowtimeContext | null>();
      for (const id of [...new Set([found.showtime_id, targetId])].sort((a, b) => a - b)) {
        contexts.set(id, await this.showtimes.lockedAnyContext(id));
      }
      const current = contexts.get(found.showtime_id) ?? null;
      const target = contexts.get(targetId) ?? null;
      // §7.1 step 3: the target hall FOR SHARE, while its layout is read.
      if (target) await this.halls.lockForShare(target.view.hallId);

      // §7.1 step 5: the booking.
      const [locked] = await this.bookings.lockForUpdate([found.id]);
      if (!locked) throw new AppError('NOT_FOUND');
      if (locked.showtime_id !== found.showtime_id) {
        throw new AppError('CONFLICT', 'The booking changed meanwhile; read it again.', {
          reason: 'booking_changed',
        });
      }
      const seats = await this.bookings.seatsOf([locked.id]);
      const ledger = await this.payments.ledgerOf([locked.id]);
      const plan = await this.planFor(locked, seats, current, target, input, ledger, now);
      const payment = paymentOf(plan, input);

      // §7.1 step 6: the current claims and the target seats' claim rows, in seat order.
      const currentLabels = seats.map((seat) => seat.seat_label);
      const newLabels = plan.seats.map((seat) => seat.label);
      await this.seatClaims.lockFor([
        { showtimeId: locked.showtime_id, labels: currentLabels },
        { showtimeId: targetId, labels: newLabels },
      ]);
      await this.seatClaims.deleteOwn([
        { showtimeId: locked.showtime_id, bookingId: locked.id, labels: currentLabels },
      ]);
      const edited = await this.bookings.applyEdit(locked.id, {
        showtime_id: targetId,
        seat_count: plan.seats.length,
        total_amount: plan.total.amount,
        contact_name: plan.contact.name,
        contact_email: plan.contact.email,
        contact_phone: plan.contact.phone,
        updated_at: now,
      });
      await this.bookings.replaceSeats(
        edited.id,
        plan.seats.map((seat): BookingSeatRow => ({
          booking_id: edited.id,
          seat_label: seat.label,
          row_label: seat.rowLabel,
          seat_number: seat.seatNumber,
          zone: seat.zone,
          price: seat.price.amount,
          is_wheelchair: seat.isWheelchair,
        })),
      );
      const outcome = await this.seatClaims.write({
        now,
        claim: {
          showtimeId: targetId,
          bookingId: edited.id,
          labels: newLabels,
          claimedUntil: null,
        },
        release: [],
      });
      if (outcome.missing.length > 0) {
        throw new AppError('SEAT_TAKEN', undefined, { seats: [...outcome.missing] });
      }

      const actor: AuditActor = { kind: 'staff', id: staff.id };
      const written = await this.settleDifference(staff, edited, plan, payment, actor);
      await this.audit.record({
        actor,
        action: BOOKING_EDITED_ACTION,
        entity: { type: BOOKING_ENTITY, id: edited.id },
        bookingId: edited.id,
        changedFields: plan.changedFields,
        metadata: {
          reason: input.reason,
          fromShowtimeId: locked.showtime_id,
          toShowtimeId: targetId,
          seatCount: plan.seats.length,
          difference:
            plan.difference.direction === 'refund'
              ? -plan.difference.amount.amount
              : plan.difference.amount.amount,
          notify: input.notify,
        },
      });
      if (input.notify) await this.tickets.queueTickets([edited.id], { sms: true });
      await this.announce(locked.showtime_id, currentLabels, targetId, newLabels);
      return {
        booking: await this.views.of(edited, now),
        difference: plan.difference,
        changedFields: plan.changedFields,
        payments: written,
      };
    });
  }

  /**
   * The checks every edit passes, then the plan (`planEdit()`): the booking editable, the target
   * a published showtime of the same movie and, when seats or the showtime change, bookable; the
   * seats in the target hall's layout.
   */
  private async planFor(
    row: BookingRow,
    seats: readonly BookingSeatRow[],
    current: ShowtimeContext | null,
    target: ShowtimeContext | null,
    input: EditBookingInput,
    ledger: readonly LedgerEntry[],
    now: Date,
  ): Promise<EditPlan> {
    if (!current) {
      throw new AppError('INTERNAL', 'A booking references a showtime that does not exist.');
    }
    assertEditable(row, current, now);
    if (!target || target.theaterStatus === 'draft') throw unknownShowtime();
    if (target.view.movieId !== current.view.movieId) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fields: [{ field: 'showtimeId', messages: ['Pick a showtime of the same movie.'] }],
      });
    }
    const labels = input.seats ?? seats.map((seat) => seat.seat_label);
    const moving =
      target.view.id !== row.showtime_id ||
      sortedLabels(labels).join() !== sortedLabels(seats.map((seat) => seat.seat_label)).join();
    const hall = await this.halls.findById(target.view.hallId);
    if (!hall) throw new AppError('INTERNAL', 'A showtime references a hall that does not exist.');
    if (moving) {
      const reason = notBookableReason(
        {
          showtimeStatus: target.view.status,
          startsAt: target.view.startsAt,
          theaterStatus: target.theaterStatus,
          movieStatus: target.movieStatus,
          hallStatus: hall.status,
        },
        now,
      );
      if (reason) throw new AppError('SHOWTIME_NOT_BOOKABLE', undefined, { reason });
    }
    const layout = await this.halls.findLayout(target.view.hallId);
    if (!layout) {
      throw new AppError('INTERNAL', 'A showtime references a hall that does not exist.');
    }
    return planEdit({
      row,
      currentSeats: seats,
      target: {
        showtimeId: target.view.id,
        prices: target.view.prices,
        layout: new Map(layoutSeats(layout).map((seat): [string, HallSeat] => [seat.label, seat])),
      },
      labels,
      contact: input.contact,
      ledger,
    });
  }

  /**
   * The edit's money (design §7.8 step 6): a lower total refunded across the charges newest
   * first, each on its rail (`edit_difference`); a higher one taken at the counter now, collected
   * by the admin. Returns the rows written.
   */
  private async settleDifference(
    staff: StaffPrincipal,
    row: BookingRow,
    plan: EditPlan,
    payment: EditBookingInput['payment'],
    actor: AuditActor,
  ): Promise<LedgerEntry[]> {
    if (plan.difference.direction === 'refund') {
      const refunds = await this.payments.refund(
        plan.refunds.map((refund) => ({
          charge: refund.charge,
          amount: refund.amount,
          reference: row.reference,
        })),
        'edit_difference',
      );
      await this.audit.recordMany(refunds.map((refund) => refundEvent(actor, refund)));
      return [...refunds];
    }
    if (plan.difference.direction === 'collect' && payment) {
      const charge = await this.payments.recordCounterCharge({
        bookingId: row.id,
        amount: money(plan.difference.amount.amount, plan.difference.amount.currency),
        method: payment.method,
        receiptReference: payment.method === 'card_terminal' ? payment.receiptReference : null,
        purpose: 'edit_difference',
        collectedByStaffId: staff.id,
      });
      await this.audit.record({
        actor,
        action: `payment.${charge.status}`,
        entity: { type: PAYMENT_ENTITY, id: charge.id },
        bookingId: row.id,
        metadata: { method: charge.method, purpose: charge.purpose, channel: 'counter' },
      });
      const entry = await this.payments.findLedgerEntry(charge.id);
      return entry ? [entry] : [];
    }
    return [];
  }

  /** After commit: the seats the edit freed on the old showtime and sold on the target. */
  private async announce(
    fromShowtimeId: number,
    fromLabels: readonly string[],
    toShowtimeId: number,
    toLabels: readonly string[],
  ): Promise<void> {
    const same = fromShowtimeId === toShowtimeId;
    const kept = new Set(same ? toLabels : []);
    const before = new Set(same ? fromLabels : []);
    await this.events.publishAfterCommit({
      type: 'seat.released',
      showtimeId: fromShowtimeId,
      labels: sortedLabels(fromLabels.filter((label) => !kept.has(label))),
    });
    await this.events.publishAfterCommit({
      type: 'seat.booked',
      showtimeId: toShowtimeId,
      labels: sortedLabels(toLabels.filter((label) => !before.has(label))),
    });
  }
}

/**
 * Only a confirmed booking whose showtime has not started, never checked in, is edited (PRD:
 * Completed, Refunded, Failed and Abandoned can't be; U1's catalogue: nor checked in or started).
 */
export function assertEditable(row: BookingRow, current: ShowtimeContext, now: Date): void {
  const status = bookingStatusOf(
    {
      status: row.status,
      holdExpiresAt: row.hold_expires_at,
      hasDeclinedPayment: row.has_declined_payment,
      showtimeEndsAt: current.view.endsAt,
    },
    now,
  );
  if (status !== 'confirmed') {
    throw new AppError('BOOKING_NOT_EDITABLE', undefined, { reason: 'not_confirmed', status });
  }
  if (row.checked_in_at !== null) {
    throw new AppError('BOOKING_NOT_EDITABLE', undefined, { reason: 'checked_in', status });
  }
  if (current.view.startsAt.getTime() <= now.getTime()) {
    throw new AppError('BOOKING_NOT_EDITABLE', undefined, { reason: 'started', status });
  }
}

/**
 * The counter payment of a higher total, required exactly then (design §7.8 step 6): missing when
 * the total goes up, or sent when it does not, is `VALIDATION_FAILED` on `payment`.
 */
function paymentOf(plan: EditPlan, input: EditBookingInput): EditBookingInput['payment'] {
  if (plan.difference.direction === 'collect' && !input.payment) {
    throw new AppError('VALIDATION_FAILED', undefined, {
      fields: [
        {
          field: 'payment',
          messages: [
            `The new total is higher: take the difference at the counter and send payment (cash or card_terminal).`,
          ],
        },
      ],
    });
  }
  if (plan.difference.direction !== 'collect' && input.payment) {
    throw new AppError('VALIDATION_FAILED', undefined, {
      fields: [{ field: 'payment', messages: ['payment is sent only when the total goes up.'] }],
    });
  }
  return input.payment;
}

function unknownShowtime(): AppError {
  return new AppError('VALIDATION_FAILED', undefined, {
    fields: [{ field: 'showtimeId', messages: ['No published showtime has this id.'] }],
  });
}

function toBookingSeat(seat: BookingSeatRow, row: BookingRow): BookingSeat {
  return {
    label: seat.seat_label,
    rowLabel: seat.row_label,
    seatNumber: seat.seat_number,
    zone: seat.zone,
    price: money(seat.price, row.currency),
    isWheelchair: seat.is_wheelchair,
  };
}
