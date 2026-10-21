import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { AuditActor } from '../../common/audit/types';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { SeatClaimService } from '../seating/seat-claim.service';
import { SeatEventPublisher } from '../seating/seat-event.publisher';
import { BOOKING_ENTITY } from './bookings.constants';
import { BookingsRepository } from './bookings.repository';
import { TicketsService } from './tickets.service';
import type { ConfirmBookingInput } from './types';

/**
 * Confirms held bookings whose payment succeeded (design §7.5 step 6; PRD Payments 3): the
 * booking becomes `confirmed` with `confirmed_at` and its first QR version, every claim is made
 * permanent (checked with `RETURNING`), the tickets email (and SMS with a phone) is queued, the
 * confirmation is audited, and `seat.booked` goes out once the transaction commits. Nothing is
 * sent and nothing is announced when it rolls back.
 *
 * Call it in the open transaction with the bookings locked `FOR UPDATE` and their claims locked
 * (design §7.1 steps 5–6). A batch costs a fixed number of statements, whatever its size.
 * Exported for counter sales (U13).
 */
@Injectable()
export class BookingConfirmationService {
  constructor(
    private readonly bookings: BookingsRepository,
    private readonly seatClaims: SeatClaimService,
    private readonly tickets: TicketsService,
    private readonly events: SeatEventPublisher,
    private readonly audit: AuditService,
    private readonly context: TransactionContext,
    private readonly clock: Clock,
  ) {}

  async confirm(items: readonly ConfirmBookingInput[], actor: AuditActor): Promise<void> {
    if (!this.context.isActive()) {
      throw new AppError('INTERNAL', 'Bookings are confirmed inside a transaction.');
    }
    if (items.length === 0) return;
    const now = this.clock.now();
    const ids = items.map((item) => item.bookingId);
    const confirmed = await this.bookings.confirm(ids, now);
    if (confirmed.length !== new Set(ids).size) {
      throw new AppError('INTERNAL', 'A booking to confirm was no longer held.');
    }
    const sold = await this.seatClaims.confirm(items);
    const seatCount = items.reduce((sum, item) => sum + item.labels.length, 0);
    if (sold !== seatCount) {
      throw new AppError('INTERNAL', "A booking's seat claims were not all its own.");
    }
    await this.tickets.queueTickets(ids, { sms: true });
    await this.audit.recordMany(
      items.map((item) => ({
        actor,
        action: 'booking.confirmed',
        entity: { type: BOOKING_ENTITY, id: item.bookingId },
        bookingId: item.bookingId,
        metadata: {
          showtimeId: item.showtimeId,
          seatCount: item.labels.length,
          channel: item.channel,
        },
      })),
    );
    for (const item of items) {
      await this.events.publishAfterCommit({
        type: 'seat.booked',
        showtimeId: item.showtimeId,
        labels: item.labels,
      });
    }
  }
}
