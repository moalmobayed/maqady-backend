import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { AuditActor } from '../../common/audit/types';
import type { StaffPrincipal } from '../../common/auth/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { money } from '../../common/money/money';
import { Clock } from '../../common/time/clock';
import { CustomerService } from '../customers/customer.service';
import { HallReadService } from '../halls/hall-read.service';
import { PaymentsService } from '../payments/payments.service';
import { SeatClaimService } from '../seating/seat-claim.service';
import { notBookableReason } from './bookability';
import { BookingConfirmationService } from './booking-confirmation.service';
import { BookingReadService } from './booking-read.service';
import { BookingShowtimeService } from './booking-showtime.service';
import { isLiveHold } from './booking-status.sql';
import { PAYMENT_ENTITY } from './bookings.constants';
import { BookingsRepository } from './bookings.repository';
import { HoldsService } from './holds.service';
import type {
  Booking,
  BookingRow,
  CheckoutResult,
  CounterCustomer,
  CounterCustomerColumns,
  CounterHoldInput,
  CounterPaymentInput,
} from './types';

/**
 * The box office's counter sales (design §7.6; PRD Payments 2, A6 "New booking", call 4). A
 * counter hold is U10's hold with a staff holder (`HoldsService`), so it competes with online
 * holds through the same claim statement and lock order, and a seat is never sold twice across
 * channels. A member has at most one live counter hold and acts only on their own, admins
 * included: another member's is `FORBIDDEN` (staff read every booking, design §10.4, so it is not
 * hidden), anything that is not a counter booking `NOT_FOUND`.
 *
 * Recording the payment takes the locks of §7.5 steps 2–4 (showtime `FOR SHARE`, the existing
 * customer, the booking `FOR UPDATE`, its claims `FOR UPDATE`) and confirms in the same
 * transaction, exactly once: a second payment waits on the booking lock and then finds it paid.
 * Every write is audited in its transaction, with the member as actor and no personal data.
 */
@Injectable()
export class CounterSalesService {
  constructor(
    private readonly holds: HoldsService,
    private readonly reads: BookingReadService,
    private readonly bookings: BookingsRepository,
    private readonly showtimes: BookingShowtimeService,
    private readonly halls: HallReadService,
    private readonly customers: CustomerService,
    private readonly seatClaims: SeatClaimService,
    private readonly payments: PaymentsService,
    private readonly confirmation: BookingConfirmationService,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /**
   * Holds the seats for 5 minutes (capped at the start) as the member's counter hold, releasing
   * their previous live one (design §7.3 with a staff holder). Answers the booking as staff read it.
   */
  async createHold(staff: StaffPrincipal, input: CounterHoldInput): Promise<Booking> {
    const created = await this.holds.create({
      showtimeId: input.showtimeId,
      labels: input.labels,
      holder: { kind: 'staff', staffUserId: staff.id },
    });
    return created.booking;
  }

  /**
   * Releases the member's own counter hold now (U10's release): its seats are free at once and
   * it reads as Abandoned. A hold that already ended changes nothing; a paid one is `ALREADY_PAID`.
   */
  async releaseHold(staff: StaffPrincipal, reference: string): Promise<void> {
    await this.transactions.run(async () => {
      const found = await this.ownCounterBooking(staff, reference);
      if (found.status !== 'held') throw new AppError('ALREADY_PAID');
      await this.holds.release({ staffUserId: staff.id }, reference);
    });
  }

  /**
   * Records cash or a card-terminal payment for the member's counter hold and confirms it (design
   * §7.6 step 2). Refusals, in this order, each writing nothing: `NOT_FOUND` (not a counter
   * booking), `FORBIDDEN` (another member's), `ALREADY_PAID`, `SHOWTIME_NOT_BOOKABLE { reason }`,
   * `VALIDATION_FAILED` on `customer.customerId` (no active customer), then under the booking lock
   * `ALREADY_PAID` or `HOLD_EXPIRED` (at `holdExpiresAt` exactly, too), then under the claim locks
   * `HOLD_EXPIRED` (a seat is no longer the hold's).
   */
  async pay(
    staff: StaffPrincipal,
    reference: string,
    input: CounterPaymentInput,
  ): Promise<CheckoutResult> {
    return this.transactions.run(async () => {
      const now = this.clock.now();
      const found = await this.ownCounterBooking(staff, reference);
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

      const columns = await this.customerColumns(input.customer, now);

      const [locked] = await this.bookings.lockForUpdate([found.id]);
      if (!locked || locked.created_by_staff_id !== staff.id) throw new AppError('NOT_FOUND');
      if (locked.status !== 'held') throw new AppError('ALREADY_PAID');
      if (!isLiveHold({ status: locked.status, holdExpiresAt: locked.hold_expires_at }, now)) {
        throw new AppError('HOLD_EXPIRED');
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

      const payment = await this.payments.recordCounterCharge({
        bookingId: locked.id,
        amount: money(locked.total_amount, locked.currency),
        method: input.method,
        receiptReference: input.receiptReference,
        purpose: 'sale',
        collectedByStaffId: staff.id,
      });
      await this.bookings.setCounterCustomer(locked.id, columns);
      const actor: AuditActor = { kind: 'staff', id: staff.id };
      await this.confirmation.confirm(
        [{ bookingId: locked.id, showtimeId: locked.showtime_id, channel: 'counter', labels }],
        actor,
      );
      await this.audit.record({
        actor,
        action: `payment.${payment.status}`,
        entity: { type: PAYMENT_ENTITY, id: payment.id },
        bookingId: locked.id,
        metadata: {
          method: payment.method,
          purpose: payment.purpose,
          channel: 'counter',
          customerKind: input.customer.kind,
        },
      });
      return { payment, booking: await this.reads.getForStaff(reference) };
    });
  }

  /**
   * The member's own counter booking, read without locks: not a counter booking (or unknown) is
   * `NOT_FOUND`; another member's is `FORBIDDEN { reason: 'not_your_counter_hold' }`.
   */
  private async ownCounterBooking(staff: StaffPrincipal, reference: string): Promise<BookingRow> {
    const found = await this.bookings.findByReference(reference);
    if (!found || found.channel !== 'counter') throw new AppError('NOT_FOUND');
    if (found.created_by_staff_id !== staff.id) {
      throw new AppError('FORBIDDEN', undefined, { reason: 'not_your_counter_hold' });
    }
    return found;
  }

  /**
   * What the sale writes onto the booking (PRD A6): nothing for a walk-in; an existing customer
   * (locked, design §7.1 step 4) with their name, email and phone copied as the contact; typed
   * contact details with no customer, never linked to an account by their email.
   */
  private async customerColumns(
    customer: CounterCustomer,
    now: Date,
  ): Promise<CounterCustomerColumns> {
    switch (customer.kind) {
      case 'walk_in':
        return {
          customer_id: null,
          contact_name: null,
          contact_email: null,
          contact_phone: null,
          updated_at: now,
        };
      case 'existing': {
        const found = await this.customers.findByIdForUpdate(customer.customerId);
        if (!found || found.deletedAt !== null || found.status !== 'active') {
          throw new AppError('VALIDATION_FAILED', undefined, {
            fields: [
              {
                field: 'customer.customerId',
                messages: ['No active customer account has this id.'],
              },
            ],
          });
        }
        return {
          customer_id: found.id,
          contact_name: found.fullName,
          contact_email: found.email,
          contact_phone: found.phone,
          updated_at: now,
        };
      }
      case 'contact':
        return {
          customer_id: null,
          contact_name: customer.fullName,
          contact_email: customer.email,
          contact_phone: customer.phone,
          updated_at: now,
        };
    }
  }
}
