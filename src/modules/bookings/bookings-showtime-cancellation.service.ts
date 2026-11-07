import { Injectable, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { AuditActor } from '../../common/audit/types';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import { sumMoney } from '../../common/money/money';
import { Clock } from '../../common/time/clock';
import { formatCairoDisplay } from '../../common/time/time';
import { MessagingService } from '../messaging/messaging.service';
import type { QueueMessageInput } from '../messaging/types';
import { PaymentsService } from '../payments/payments.service';
import { SeatClaimService } from '../seating/seat-claim.service';
import { SeatEventPublisher } from '../seating/seat-event.publisher';
import {
  RegisteredShowtimeCancellation,
  ShowtimeCancellationService,
} from '../showtimes/showtime-cancellation.service';
import { ShowtimeReadService } from '../showtimes/showtime-read.service';
import type { ShowtimeCancellationInput, ShowtimeCancellationOutcome } from '../showtimes/types';
import { BookingRefundsService, refundSplitOf } from './booking-refunds.service';
import { BookingShowtimeService } from './booking-showtime.service';
import { isLiveHold } from './booking-status.sql';
import { BOOKING_ENTITY } from './bookings.constants';
import { BookingsRepository } from './bookings.repository';
import { refundEverything } from './refund-allocation';
import { showtimeCancelledSmsTemplate } from './templates/showtime-cancelled-sms.template';
import { showtimeCancelledTemplate } from './templates/showtime-cancelled.template';
import type {
  BookingRow,
  BookingSeatRow,
  BookingShowtime,
  RefundedBooking,
  ShowtimeCancellationPreview,
  ShowtimeCancelledParams,
} from './types';

/**
 * Cancelling a showtime's bookings (design §7.7; PRD "Cancellations" 4, "Email and SMS"), the real
 * `ShowtimeCancellationService` U7 calls from `PATCH /admin/showtimes/{id}`. Registered with
 * showtimes' `RegisteredShowtimeCancellation` at boot, since showtimes cannot import bookings.
 *
 * It runs in the PATCH's transaction, after the theater `FOR SHARE` and the showtime `FOR
 * UPDATE` (§7.1 step 2): any payment in flight has committed, and any later one waits and then
 * sees the cancellation. Then, all batched, never one query per booking:
 *
 * 1. the showtime's confirmed bookings and live holds `FOR UPDATE` in id order (step 5), and all
 *    their claims in seat order (step 6);
 * 2. every confirmed booking refunded in full on its rails (`BookingRefundsService.refundLocked`);
 * 3. every live hold ended now and its claims deleted (`booking.released`, reason
 *    `showtime_cancelled`); a hold whose payment is still processing is ended too, and settlement
 *    refunds that payment at once if it succeeds, because the showtime is cancelled (U11);
 * 4. one `showtime.cancelled` email per refunded booking with an email and one
 *    `showtime.cancelled_sms` per booking with a phone, in one insert.
 *
 * `preview()` computes the same figures without locks (`GET /admin/showtimes/{id}/cancellation-preview`).
 */
@Injectable()
export class BookingsShowtimeCancellation
  extends ShowtimeCancellationService
  implements OnModuleInit
{
  constructor(
    private readonly registry: RegisteredShowtimeCancellation,
    private readonly bookings: BookingsRepository,
    private readonly refunds: BookingRefundsService,
    private readonly showtimes: ShowtimeReadService,
    private readonly headers: BookingShowtimeService,
    private readonly payments: PaymentsService,
    private readonly seatClaims: SeatClaimService,
    private readonly events: SeatEventPublisher,
    private readonly messaging: MessagingService,
    private readonly audit: AuditService,
    private readonly context: TransactionContext,
    private readonly clock: Clock,
  ) {
    super();
  }

  onModuleInit(): void {
    this.registry.register(this);
  }

  async cancelBookings(input: ShowtimeCancellationInput): Promise<ShowtimeCancellationOutcome> {
    if (!this.context.isActive()) {
      throw new AppError('INTERNAL', "A showtime's bookings are cancelled inside a transaction.");
    }
    const now = this.clock.now();
    const showtimeId = input.showtime.id;
    const ids = await this.bookings.confirmedOrLiveHeldIdsOf(showtimeId, now);
    if (ids.length === 0)
      return { refundedBookingCount: 0, releasedHoldCount: 0, notifiedCount: 0 };

    const locked = (await this.bookings.lockForUpdate(ids)).filter(
      (row) => row.showtime_id === showtimeId,
    );
    const confirmed = locked.filter((row) => row.status === 'confirmed');
    const holds = locked.filter((row) =>
      isLiveHold({ status: row.status, holdExpiresAt: row.hold_expires_at }, now),
    );
    const seats = await this.bookings.seatsOf([...confirmed, ...holds].map((row) => row.id));
    // Every claim of the showtime this cancellation touches, in seat order, before any write.
    await this.seatClaims.lockFor([{ showtimeId, labels: seats.map((seat) => seat.seat_label) }]);

    const actor: AuditActor = { kind: 'staff', id: input.actor.id };
    const refunded = await this.refunds.refundLocked(confirmed, {
      actor,
      now,
      reason: 'showtime_cancelled',
      notify: false,
    });
    await this.releaseHolds(holds, seats, actor, now);
    const notified = await this.notify(refunded, input.showtime.id);
    return {
      refundedBookingCount: refunded.length,
      releasedHoldCount: holds.length,
      notifiedCount: notified,
    };
  }

  /**
   * What cancelling the showtime would do now (design §7.7 "Cancellation preview", PRD A5): the
   * bookings and seats affected, the refunds by rail (each charge's remaining amount), the live
   * holds released and the messages sent. Unknown showtime: `NOT_FOUND`.
   */
  async preview(showtimeId: number): Promise<ShowtimeCancellationPreview> {
    const now = this.clock.now();
    const view = await this.showtimes.findById(showtimeId);
    if (!view) throw new AppError('NOT_FOUND');
    // One after the other: inside a transaction they would share one connection.
    const rows = await this.bookings.findByIds(
      await this.bookings.confirmedOrLiveHeldIdsOf(showtimeId, now),
    );
    const confirmed = rows.filter((row) => row.status === 'confirmed');
    const holds = rows.filter((row) =>
      isLiveHold({ status: row.status, holdExpiresAt: row.hold_expires_at }, now),
    );
    const ledger = await this.payments.ledgerOf(confirmed.map((row) => row.id));
    const planned = refundEverything(ledger);
    const online = planned.filter(
      ({ charge }) => charge.method === 'card' || charge.method === 'wallet',
    );
    const counter = planned.filter((refund) => !online.includes(refund));
    const currency = view.prices.front.currency;
    return {
      showtimeId,
      cancellable: view.status === 'scheduled' && view.endsAt.getTime() > now.getTime(),
      bookingCount: confirmed.length,
      seatCount: confirmed.reduce((sum, row) => sum + row.seat_count, 0),
      refundedOnline: sumMoney(
        online.map((refund) => refund.amount),
        currency,
      ),
      owedAtCounter: sumMoney(
        counter.map((refund) => refund.amount),
        currency,
      ),
      liveHoldCount: holds.length,
      emailCount: confirmed.filter((row) => row.contact_email !== null).length,
      smsCount: confirmed.filter((row) => row.contact_phone !== null).length,
    };
  }

  /** Ends these live holds now and deletes their claims, announcing the seats free after commit. */
  private async releaseHolds(
    holds: readonly BookingRow[],
    seats: readonly BookingSeatRow[],
    actor: AuditActor,
    now: Date,
  ): Promise<void> {
    if (holds.length === 0) return;
    await this.bookings.expireHolds(
      holds.map((row) => row.id),
      now,
    );
    const freed = await this.seatClaims.deleteOwn(
      holds.map((row) => ({
        showtimeId: row.showtime_id,
        bookingId: row.id,
        labels: seats.filter((seat) => seat.booking_id === row.id).map((seat) => seat.seat_label),
      })),
    );
    await this.audit.recordMany(
      holds.map((row) => ({
        actor,
        action: 'booking.released',
        entity: { type: BOOKING_ENTITY, id: row.id },
        bookingId: row.id,
        metadata: { showtimeId: row.showtime_id, reason: 'showtime_cancelled' },
      })),
    );
    for (const { showtimeId, labels } of freed) {
      await this.events.publishAfterCommit({ type: 'seat.released', showtimeId, labels });
    }
  }

  /**
   * The cancellation email to every refunded booking with an email and the SMS to every one with
   * a phone, in one insert; returns how many bookings were sent at least one message.
   */
  private async notify(refunded: readonly RefundedBooking[], showtimeId: number): Promise<number> {
    if (refunded.length === 0) return 0;
    const header = (await this.headers.headersOf([showtimeId])).get(showtimeId);
    if (!header) throw new AppError('INTERNAL', 'A cancelled showtime could not be read back.');
    const inputs: QueueMessageInput<ShowtimeCancelledParams>[] = [];
    let notified = 0;
    for (const { row, refunds } of refunded) {
      const params = cancelledParams(row, header, refunds);
      const related = {
        bookingId: row.id,
        ...(row.customer_id === null ? {} : { customerId: row.customer_id }),
      };
      if (row.contact_email !== null) {
        inputs.push({
          template: showtimeCancelledTemplate,
          recipient: row.contact_email,
          params,
          related,
        });
      }
      if (row.contact_phone !== null) {
        inputs.push({
          template: showtimeCancelledSmsTemplate,
          recipient: row.contact_phone,
          params,
          related,
        });
      }
      if (row.contact_email !== null || row.contact_phone !== null) notified += 1;
    }
    await this.messaging.queueMany(inputs);
    return notified;
  }
}

function cancelledParams(
  row: BookingRow,
  header: BookingShowtime,
  refunds: RefundedBooking['refunds'],
): ShowtimeCancelledParams {
  const split = refundSplitOf(refunds, row);
  return {
    reference: row.reference,
    customerName: row.contact_name,
    movieTitle: header.movie.title,
    theaterName: header.theater.name,
    hallName: header.hall.name,
    startsAt: formatCairoDisplay(header.startsAt),
    amount: split.amount,
    onlineAmount: split.onlineAmount,
    counterAmount: split.counterAmount,
  };
}
