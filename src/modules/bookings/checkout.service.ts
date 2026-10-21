import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { AuditActor } from '../../common/audit/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { money } from '../../common/money/money';
import { Clock } from '../../common/time/clock';
import { addToInstant } from '../../common/time/time';
import { CustomerService } from '../customers/customer.service';
import { HallReadService } from '../halls/hall-read.service';
import { PaymentsService } from '../payments/payments.service';
import type { Payment } from '../payments/types';
import { SeatClaimService } from '../seating/seat-claim.service';
import { SeatEventPublisher } from '../seating/seat-event.publisher';
import { notBookableReason } from './bookability';
import { BookingConfirmationService } from './booking-confirmation.service';
import { isLiveHold } from './booking-status.sql';
import { BookingShowtimeService } from './booking-showtime.service';
import { BookingViews } from './booking-views.service';
import { PAYMENT_ENTITY, PROCESSING_GRACE_SECONDS } from './bookings.constants';
import { BookingsRepository } from './bookings.repository';
import type { BookingRow, CheckoutInput, CheckoutResult } from './types';

/**
 * Paying for a hold online (design §7.5; PRD Payments 1–4, Seats 5, C8). One request
 * transaction, its locks in the global order of §7.1 (step 1, settling due payments, already ran
 * before the transaction, `@SettleFirst('booking')`):
 *
 * 2. the showtime `FOR SHARE`, re-checked as bookable; 4. the customer; 5. the booking
 * `FOR UPDATE`; 6. its seat claims `FOR UPDATE`, in seat order. Then the charge is inserted as
 * `processing`, the provider called, and its result recorded.
 *
 * - **succeeded**: the booking is confirmed (`BookingConfirmationService`), exactly once: a
 *   second payment waits on the booking lock and then finds it paid (`ALREADY_PAID`), and the
 *   partial unique index on `payments` backs that.
 * - **declined**: the hold is marked as having a declined payment and stays payable until it
 *   ends; **cancelled** (a wallet closed) changes nothing. Both are `201` results that commit.
 * - **processing**: the hold and its claims last until the result is in, plus 30 seconds
 *   (never shorter than they were), announced with `seat.held`; settlement finishes it.
 */
@Injectable()
export class CheckoutService {
  constructor(
    private readonly bookings: BookingsRepository,
    private readonly showtimes: BookingShowtimeService,
    private readonly halls: HallReadService,
    private readonly customers: CustomerService,
    private readonly seatClaims: SeatClaimService,
    private readonly payments: PaymentsService,
    private readonly confirmation: BookingConfirmationService,
    private readonly events: SeatEventPublisher,
    private readonly views: BookingViews,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /**
   * Refusals, in this order: `NOT_FOUND` (not the caller's booking), `ALREADY_PAID`,
   * `SHOWTIME_NOT_BOOKABLE { reason }`, `UNAUTHENTICATED` / `ACCOUNT_BLOCKED`, then under the
   * booking lock `ALREADY_PAID`, `HOLD_EXPIRED` (the hold ended: at `holdExpiresAt` exactly, too)
   * or `PAYMENT_IN_PROGRESS`, then under the claim locks `HOLD_EXPIRED` (a seat is no longer the
   * hold's). Every refusal writes nothing.
   */
  async pay(input: CheckoutInput): Promise<CheckoutResult> {
    return this.transactions.run(async () => {
      const now = this.clock.now();
      const found = await this.bookings.findByReference(input.reference);
      if (!found || found.customer_id !== input.customerId) throw new AppError('NOT_FOUND');
      if (found.status !== 'held') throw new AppError('ALREADY_PAID');

      const context = await this.showtimes.lockedBookingContext(found.showtime_id);
      const hall = await this.halls.findById(context.view.hallId);
      if (!hall)
        throw new AppError('INTERNAL', 'A showtime references a hall that does not exist.');
      const reason = notBookableReason(
        {
          showtimeStatus: context.view.status,
          startsAt: context.view.startsAt,
          theaterStatus: context.theaterStatus,
          movieStatus: context.movieStatus,
          hallStatus: hall.status,
        },
        now,
      );
      if (reason) throw new AppError('SHOWTIME_NOT_BOOKABLE', undefined, { reason });

      const customer = await this.customers.findByIdForUpdate(input.customerId);
      if (!customer || customer.deletedAt !== null) throw new AppError('UNAUTHENTICATED');
      if (customer.status === 'blocked') throw new AppError('ACCOUNT_BLOCKED');

      const [locked] = await this.bookings.lockForUpdate([found.id]);
      if (!locked || locked.customer_id !== input.customerId) throw new AppError('NOT_FOUND');
      if (locked.status !== 'held') throw new AppError('ALREADY_PAID');
      if (!isLiveHold({ status: locked.status, holdExpiresAt: locked.hold_expires_at }, now)) {
        throw new AppError('HOLD_EXPIRED');
      }
      if ((await this.payments.processingSaleBookingIds([locked.id])).size > 0) {
        throw new AppError('PAYMENT_IN_PROGRESS');
      }

      const labels = (await this.bookings.seatsOf([locked.id])).map((seat) => seat.seat_label);
      const claims = await this.seatClaims.lockFor([{ showtimeId: locked.showtime_id, labels }]);
      const intact =
        claims.length === labels.length &&
        claims.every(
          (claim) =>
            claim.booking_id === locked.id &&
            claim.claimed_until !== null &&
            claim.claimed_until.getTime() > now.getTime(),
        );
      if (!intact) throw new AppError('HOLD_EXPIRED');

      const payment = await this.payments.chargeOnline({
        bookingId: locked.id,
        reference: locked.reference,
        amount: money(locked.total_amount, locked.currency),
        method: input.method,
        token: input.token,
      });
      const actor: AuditActor = { kind: 'customer', id: input.customerId };
      const settled = await this.apply(locked, labels, payment, actor, now);
      await this.audit.record({
        actor,
        action: `payment.${payment.status}`,
        entity: { type: PAYMENT_ENTITY, id: payment.id },
        bookingId: locked.id,
        metadata: { method: payment.method, purpose: payment.purpose },
      });
      return { payment, booking: await this.views.of(settled, now) };
    });
  }

  /** Applies a charge's result to the locked hold; returns the booking row as it now is. */
  private async apply(
    locked: BookingRow,
    labels: readonly string[],
    payment: Payment,
    actor: AuditActor,
    now: Date,
  ): Promise<BookingRow> {
    switch (payment.status) {
      case 'succeeded':
        await this.confirmation.confirm(
          [
            {
              bookingId: locked.id,
              showtimeId: locked.showtime_id,
              channel: locked.channel,
              labels,
            },
          ],
          actor,
        );
        break;
      case 'declined':
        await this.bookings.markDeclined([locked.id], now);
        break;
      case 'processing':
        return this.extendForProcessing(locked, labels, payment, now);
      default:
        break;
    }
    const [row] = await this.bookings.findByIds([locked.id]);
    if (!row) throw new AppError('INTERNAL', 'The booking disappeared during its payment.');
    return row;
  }

  /**
   * Keeps a processing payment's seats until its result is in plus 30 seconds, never shorter
   * than the hold already was (design §7.5 "Processing"; PRD Seats 5), and announces the new end.
   */
  private async extendForProcessing(
    locked: BookingRow,
    labels: readonly string[],
    payment: Payment,
    now: Date,
  ): Promise<BookingRow> {
    if (payment.settlesAt === null) {
      throw new AppError('INTERNAL', 'A processing payment has no settlement time.');
    }
    const grace = addToInstant(payment.settlesAt, { seconds: PROCESSING_GRACE_SECONDS });
    if (grace.getTime() <= locked.hold_expires_at.getTime()) return locked;
    const extended = await this.bookings.extendHold(locked.id, grace, now);
    const changed = await this.seatClaims.extend(
      { showtimeId: locked.showtime_id, bookingId: locked.id, labels },
      grace,
    );
    if (changed !== labels.length) {
      throw new AppError('INTERNAL', "A processing hold's claims were not all its own.");
    }
    await this.events.publishAfterCommit({
      type: 'seat.held',
      showtimeId: locked.showtime_id,
      labels,
      heldUntil: grace,
    });
    return extended;
  }
}
