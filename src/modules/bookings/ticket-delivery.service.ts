import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { CustomerService } from '../customers/customer.service';
import { ShowtimeReadService } from '../showtimes/showtime-read.service';
import { hasTicket } from './booking-assembly';
import { bookingStatusOf } from './booking-status.sql';
import { BOOKING_ENTITY, TICKETS_RESENT_ACTION } from './bookings.constants';
import { BookingsRepository } from './bookings.repository';
import { TicketsService } from './tickets.service';
import type { TicketDelivery } from './types';

/**
 * "Email again" (PRD C11, "Email and SMS"): queues the tickets email of the caller's confirmed
 * or completed booking to the customer's own account email, never by SMS, in the request
 * transaction, so it leaves only once that commits (design §13.1). The idempotency key (strict)
 * and the rate limit (3 an hour per booking and caller) are checked before this runs.
 *
 * Refusals, in order: `NOT_FOUND` (not the caller's booking, before any lock); under the
 * booking's `FOR UPDATE` lock (design §7.1 step 5, the only lock it takes)
 * `TICKET_NOT_AVAILABLE { status }`; `UNAUTHENTICATED` for an account without an email.
 */
@Injectable()
export class TicketDeliveryService {
  constructor(
    private readonly bookings: BookingsRepository,
    private readonly showtimes: ShowtimeReadService,
    private readonly customers: CustomerService,
    private readonly tickets: TicketsService,
    private readonly audit: AuditService,
    private readonly transactions: TransactionRepository,
    private readonly clock: Clock,
  ) {}

  async emailAgain(reference: string, customerId: number): Promise<TicketDelivery> {
    return this.transactions.run(async () => {
      const now = this.clock.now();
      const found = await this.bookings.findByReference(reference);
      if (!found || found.customer_id !== customerId) throw new AppError('NOT_FOUND');

      // A refund or an edit (U14) committed first is seen here; one committing later waits.
      const [locked] = await this.bookings.lockForUpdate([found.id]);
      if (!locked || locked.customer_id !== customerId) throw new AppError('NOT_FOUND');
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

      const customer = await this.customers.findById(customerId);
      if (!customer || customer.deletedAt !== null || customer.email === null) {
        throw new AppError('UNAUTHENTICATED');
      }
      await this.tickets.queueTickets([locked.id], { sms: false, emailTo: customer.email });
      await this.audit.record({
        actor: { kind: 'customer', id: customerId },
        action: TICKETS_RESENT_ACTION,
        entity: { type: BOOKING_ENTITY, id: locked.id },
        bookingId: locked.id,
        metadata: { channel: 'email' },
      });
      return { channel: 'email', queuedAt: now };
    });
  }
}
