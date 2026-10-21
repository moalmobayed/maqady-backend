import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { AuditActor, AuditEventInput } from '../../common/audit/types';
import { TransactionContext } from '../../common/database/transaction-context';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { PaymentProvider } from '../payments/payment-provider';
import { SETTLEMENT_BATCH_LIMIT } from '../payments/payments.constants';
import { PaymentsService } from '../payments/payments.service';
import type { ChargeOutcome, DueCharge, Payment } from '../payments/types';
import { SeatClaimService } from '../seating/seat-claim.service';
import { SeatEventPublisher } from '../seating/seat-event.publisher';
import type { LockedClaimRow } from '../seating/types';
import { ShowtimeReadService } from '../showtimes/showtime-read.service';
import { BookingConfirmationService } from './booking-confirmation.service';
import { BOOKING_ENTITY, PAYMENT_ENTITY } from './bookings.constants';
import { BookingsRepository } from './bookings.repository';
import type {
  AutomaticRefund,
  BookingRow,
  BookingSeatRow,
  ConfirmBookingInput,
  SettlementResult,
  SettlementScope,
} from './types';

const SYSTEM: AuditActor = { kind: 'system' };
const NOTHING: SettlementResult = { confirmed: 0, declined: 0, refunded: 0 };

/**
 * Settlement on read and on write (design §7.1 step 1, §7.5 "Settlement"): finishes every
 * processing charge whose provider result is ready, judged from its stored `settles_at`, never by
 * a timer. Routes marked `@SettleFirst()` run it before their own transaction, so whichever
 * request next reads or writes the booking or its showtime finds it settled, and reaches the same
 * state whether that request is a read or a write.
 *
 * It runs in its own short transaction, never inside another (`INTERNAL`): under a request's
 * locks it would lock bookings before that request's customer and break §7.1. Its own locks
 * follow §7.1: the showtimes `FOR SHARE` (id order), the bookings `FOR UPDATE` (id order), their
 * claims (seat order), then the charges with one conditional update. Only charges still
 * `processing` come back from that update, so two tabs polling the same booking settle it once.
 *
 * - succeeded, the showtime still scheduled and every claim still the booking's (an expired one
 *   included: PRD Seats 5): confirmed;
 * - succeeded otherwise: refunded at once through the provider, the booking `refunded`, its
 *   remaining claims deleted (`seat.released`), audited as `booking.refunded` with the reason;
 * - declined: the hold is marked declined and stays payable until it ends.
 */
@Injectable()
export class SettlementService {
  constructor(
    private readonly bookings: BookingsRepository,
    private readonly payments: PaymentsService,
    private readonly provider: PaymentProvider,
    private readonly showtimes: ShowtimeReadService,
    private readonly seatClaims: SeatClaimService,
    private readonly confirmation: BookingConfirmationService,
    private readonly events: SeatEventPublisher,
    private readonly audit: AuditService,
    private readonly transactions: TransactionRepository,
    private readonly context: TransactionContext,
    private readonly clock: Clock,
  ) {}

  /**
   * Settles the due charges of the booking with this reference, of bookings on this showtime and
   * of this customer's bookings. When nothing is due (almost always) it costs one indexed query
   * and opens no transaction.
   */
  async settleDue(scope: SettlementScope): Promise<SettlementResult> {
    if (
      scope.bookingReference === undefined &&
      scope.showtimeId === undefined &&
      scope.customerId === undefined
    ) {
      throw new AppError('INTERNAL', 'A settlement scope names a booking, showtime or customer.');
    }
    return this.settle(scope);
  }

  /** Settles every due charge, oldest first (before admin lists and dashboards: U14, U16, U17). */
  async settleAllDue(): Promise<SettlementResult> {
    return this.settle(undefined);
  }

  private async settle(scope: SettlementScope | undefined): Promise<SettlementResult> {
    if (this.context.isActive()) {
      throw new AppError('INTERNAL', 'Settlement runs in its own transaction, before any other.');
    }
    const due = await this.payments.due(SETTLEMENT_BATCH_LIMIT);
    if (due.length === 0) return NOTHING;
    const candidates = await this.bookings.findByIds(due.map((charge) => charge.bookingId));
    const inScope = new Set(
      candidates.filter((row) => scope === undefined || matches(row, scope)).map((row) => row.id),
    );
    const charges = due.filter((charge) => inScope.has(charge.bookingId));
    if (charges.length === 0) return NOTHING;
    const showtimeIds = [
      ...new Set(candidates.filter((row) => inScope.has(row.id)).map((row) => row.showtime_id)),
    ];
    return this.transactions.run(() => this.settleLocked(charges, showtimeIds));
  }

  private async settleLocked(
    charges: readonly DueCharge[],
    showtimeIds: readonly number[],
  ): Promise<SettlementResult> {
    const now = this.clock.now();
    const showtimes = await this.showtimes.lockForShareMany(showtimeIds);
    const rows = await this.bookings.lockForUpdate(charges.map((charge) => charge.bookingId));
    const seats = await this.bookings.seatsOf(rows.map((row) => row.id));
    const claims = await this.seatClaims.lockFor(
      rows.map((row) => ({ showtimeId: row.showtime_id, labels: labelsOf(seats, row.id) })),
    );

    const outcomes: ChargeOutcome[] = [];
    for (const charge of charges) {
      const result = await this.provider.retrieve({ providerReference: charge.providerReference });
      outcomes.push({ paymentId: charge.paymentId, result });
    }
    const finished = await this.payments.finishProcessing(outcomes);
    if (finished.length === 0) return NOTHING;

    const byId = new Map(rows.map((row) => [row.id, row]));
    const toConfirm: ConfirmBookingInput[] = [];
    const toRefund: AutomaticRefund[] = [];
    const declined: number[] = [];
    for (const payment of finished) {
      const row = byId.get(payment.bookingId);
      if (!row) throw new AppError('INTERNAL', 'A settled payment has no locked booking.');
      if (payment.status === 'declined') declined.push(row.id);
      if (payment.status !== 'succeeded') continue;
      const labels = labelsOf(seats, row.id);
      if (showtimes.get(row.showtime_id)?.status !== 'scheduled') {
        toRefund.push({ row, charge: payment, reason: 'showtime_cancelled' });
      } else if (row.status !== 'held' || !claimsIntact(claims, row, labels)) {
        toRefund.push({ row, charge: payment, reason: 'claims_lost' });
      } else {
        toConfirm.push({
          bookingId: row.id,
          showtimeId: row.showtime_id,
          channel: row.channel,
          labels,
        });
      }
    }

    await this.confirmation.confirm(toConfirm, SYSTEM);
    await this.refundAtOnce(toRefund, seats, now);
    await this.bookings.markDeclined(declined, now);
    await this.audit.recordMany(finished.map(paymentEvent));
    return { confirmed: toConfirm.length, declined: declined.length, refunded: toRefund.length };
  }

  /**
   * Refunds succeeded charges whose booking can no longer be confirmed (design §7.5): the money
   * goes back through the provider, the booking ends Refunded, and whatever claims it still has
   * are deleted and announced free after commit.
   */
  private async refundAtOnce(
    refunds: readonly AutomaticRefund[],
    seats: readonly BookingSeatRow[],
    now: Date,
  ): Promise<void> {
    if (refunds.length === 0) return;
    const refunded = await this.payments.refundOnline(
      refunds.map(({ row, charge }) => ({ charge, reference: row.reference })),
    );
    await this.bookings.markRefunded(
      refunds.map(({ row }) => row.id),
      now,
    );
    const freed = await this.seatClaims.deleteOwn(
      refunds.map(({ row }) => ({
        showtimeId: row.showtime_id,
        bookingId: row.id,
        labels: labelsOf(seats, row.id),
      })),
    );
    await this.audit.recordMany([
      ...refunded.map(paymentEvent),
      ...refunds.map(({ row, reason }): AuditEventInput => ({
        actor: SYSTEM,
        action: 'booking.refunded',
        entity: { type: BOOKING_ENTITY, id: row.id },
        bookingId: row.id,
        metadata: { showtimeId: row.showtime_id, reason, seatCount: row.seat_count },
      })),
    ]);
    for (const { showtimeId, labels } of freed) {
      await this.events.publishAfterCommit({ type: 'seat.released', showtimeId, labels });
    }
  }
}

function matches(row: BookingRow, scope: SettlementScope): boolean {
  return (
    (scope.bookingReference !== undefined && row.reference === scope.bookingReference) ||
    (scope.showtimeId !== undefined && row.showtime_id === scope.showtimeId) ||
    (scope.customerId !== undefined && row.customer_id === scope.customerId)
  );
}

function labelsOf(seats: readonly BookingSeatRow[], bookingId: number): string[] {
  return seats.filter((seat) => seat.booking_id === bookingId).map((seat) => seat.seat_label);
}

/** Every seat still claimed by the booking and not sold: an expired claim still counts as its own. */
function claimsIntact(
  claims: readonly LockedClaimRow[],
  row: BookingRow,
  labels: readonly string[],
): boolean {
  const own = claims.filter(
    (claim) =>
      claim.showtime_id === row.showtime_id &&
      claim.booking_id === row.id &&
      claim.claimed_until !== null,
  );
  return labels.length === row.seat_count && own.length === labels.length;
}

/** `payment.<status>`, as the system recorded it. */
function paymentEvent(payment: Payment): AuditEventInput {
  return {
    actor: SYSTEM,
    action: `payment.${payment.kind === 'refund' ? 'refunded' : payment.status}`,
    entity: { type: PAYMENT_ENTITY, id: payment.id },
    bookingId: payment.bookingId,
    metadata: { method: payment.method, purpose: payment.purpose },
  };
}
