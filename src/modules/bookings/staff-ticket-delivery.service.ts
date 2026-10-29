import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { StaffPrincipal } from '../../common/auth/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { ShowtimeReadService } from '../showtimes/showtime-read.service';
import { hasTicket } from './booking-assembly';
import { bookingStatusOf } from './booking-status.sql';
import { BOOKING_ENTITY, TICKETS_RESENT_ACTION } from './bookings.constants';
import { BookingsRepository } from './bookings.repository';
import { TicketsService } from './tickets.service';
import type { StaffTicketChannel, StaffTicketDelivery } from './types';

/**
 * "Resend tickets" by staff (PRD A6, "Email and SMS": tickets resent → the tickets email, and the
 * SMS on a staff resend when a phone is on file), both roles. Under the booking's `FOR UPDATE`
 * lock (design §7.1 step 5, the only lock it takes), so a refund or an edit committing first is
 * seen: the tickets go to the booking's contact email and phone as they are now, with its current
 * QR code, queued in the request transaction (design §13.1).
 *
 * Refusals: `NOT_FOUND`; `TICKET_NOT_AVAILABLE { status }` (not confirmed or completed);
 * `NO_CONTACT_DETAILS` (neither an email nor a phone on the booking: a walk-in).
 */
@Injectable()
export class StaffTicketDeliveryService {
  constructor(
    private readonly bookings: BookingsRepository,
    private readonly showtimes: ShowtimeReadService,
    private readonly tickets: TicketsService,
    private readonly audit: AuditService,
    private readonly transactions: TransactionRepository,
    private readonly clock: Clock,
  ) {}

  async resend(staff: StaffPrincipal, reference: string): Promise<StaffTicketDelivery> {
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
      if (!hasTicket(status)) throw new AppError('TICKET_NOT_AVAILABLE', undefined, { status });
      const channels: StaffTicketChannel[] = [
        ...(locked.contact_email !== null ? (['email'] as const) : []),
        ...(locked.contact_phone !== null ? (['sms'] as const) : []),
      ];
      if (channels.length === 0) throw new AppError('NO_CONTACT_DETAILS');
      await this.tickets.queueTickets([locked.id], { sms: true });
      await this.audit.record({
        actor: { kind: 'staff', id: staff.id },
        action: TICKETS_RESENT_ACTION,
        entity: { type: BOOKING_ENTITY, id: locked.id },
        bookingId: locked.id,
        metadata: { channels: channels.join(','), by: 'staff' },
      });
      return { channels, queuedAt: now };
    });
  }
}
