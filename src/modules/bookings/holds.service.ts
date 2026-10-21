import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { AuditActor } from '../../common/audit/types';
import type { CustomerPrincipal } from '../../common/auth/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { addToInstant } from '../../common/time/time';
import { CustomerService } from '../customers/customer.service';
import type { Customer } from '../customers/types';
import { layoutSeats } from '../halls/hall-layout';
import { HallReadService } from '../halls/hall-read.service';
import type { HallSeat } from '../halls/types';
import { sortedLabels } from '../seating/claim-plan';
import { HoldRefusalService } from '../seating/hold-refusal.service';
import { SeatClaimService } from '../seating/seat-claim.service';
import { SeatEventPublisher } from '../seating/seat-event.publisher';
import type { ReleasedClaims } from '../seating/types';
import { PaymentsService } from '../payments/payments.service';
import { notBookableReason } from './bookability';
import { toBooking } from './booking-assembly';
import { drawReference } from './booking-reference';
import { BookingShowtimeService } from './booking-showtime.service';
import { BookingViews } from './booking-views.service';
import { isLiveHold } from './booking-status.sql';
import { BOOKING_ENTITY, HOLD_MINUTES, REFERENCE_DRAWS } from './bookings.constants';
import { BookingsRepository } from './bookings.repository';
import { holdCodeHash, holdCodeMatches, newHoldCode } from './hold-code';
import type {
  Booking,
  BookingAuditEvent,
  BookingContact,
  BookingRow,
  BookingSeatRow,
  CreatedHold,
  CreateHoldInput,
  HoldAccess,
  NewBookingRow,
  HoldsToRelease,
  HoldTiming,
  InsertedHold,
  NewHoldCode,
  ReclaimedSeats,
  ReleaseReason,
  ShowtimeContext,
} from './types';

/**
 * Holds (design §7.1–§7.4, PRD "Seats and holds"): create, claim at sign-in, release. Every
 * method joins the request transaction and takes its locks in the global order of §7.1, each
 * path a subsequence of it, so two holds (or a hold and a layout save, a move, a price change,
 * a block) can wait for each other but never deadlock:
 *
 * 2. the showtime `FOR SHARE` (create only), 3. the hall `FOR SHARE` (create only), 4. the
 * customer (`FOR NO KEY UPDATE`), 5. the bookings involved `FOR UPDATE` in id order, 6. the seat
 * claims, by showtime and label (`SeatClaimService`).
 *
 * Expiry is judged from stored times against the `Clock`: nothing runs when a hold ends. A
 * released hold's claims end `now` and its `hold_expires_at` becomes `now`, so it reads as
 * Abandoned from then on. Seat events are published after the commit only.
 *
 * Due payments are settled before each route runs (`@SettleFirst()`, §7.1 step 1, U11), and a
 * hold whose payment is still processing is never released or replaced (`PAYMENT_IN_PROGRESS`,
 * U11). U13 adds the staff holder.
 */
@Injectable()
export class HoldsService {
  constructor(
    private readonly bookings: BookingsRepository,
    private readonly showtimes: BookingShowtimeService,
    private readonly halls: HallReadService,
    private readonly customers: CustomerService,
    private readonly seatClaims: SeatClaimService,
    private readonly refusals: HoldRefusalService,
    private readonly events: SeatEventPublisher,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly views: BookingViews,
    private readonly payments: PaymentsService,
  ) {}

  /**
   * Holds 1 to 8 seats of a showtime for 5 minutes (capped at its start), releasing the
   * holder's previous live hold in the same transaction: a customer's live online hold, and the
   * live unowned hold whose code they present. When a seat is taken the whole request rolls back
   * (the previous hold stays), `SEAT_TAKEN` lists the taken seats, and the refusal is recorded.
   */
  async create(input: CreateHoldInput): Promise<CreatedHold> {
    return this.transactions.run(async () => {
      const now = this.clock.now();
      const labels = sortedLabels(input.labels);

      const context = await this.showtimes.lockedContext(input.showtimeId);
      if (!context) throw new AppError('NOT_FOUND');
      const hall = await this.halls.lockForShare(context.view.hallId);
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
      const seats = await this.seatsInLayout(context.view.hallId, input.labels);

      const { holder } = input;
      const customer =
        holder.kind === 'customer' ? await this.lockCustomer(holder.customerId) : null;
      const released = await this.lockHoldsToRelease(customer?.id ?? null, holder.holdCode, now);

      const holdExpiresAt = new Date(
        Math.min(
          addToInstant(now, { minutes: HOLD_MINUTES }).getTime(),
          context.view.startsAt.getTime(),
        ),
      );
      const code = customer ? null : newHoldCode();
      const booking = await this.insertHold(context, seats, customer, code, holdExpiresAt, now);

      const outcome = await this.seatClaims.write({
        now,
        claim: {
          showtimeId: context.view.id,
          bookingId: booking.row.id,
          labels,
          claimedUntil: holdExpiresAt,
        },
        release: released.claims,
      });
      if (outcome.missing.length > 0) {
        await this.refusals.recordAfterRollback(context.view.id, labels.length);
        throw new AppError('SEAT_TAKEN', undefined, { seats: [...outcome.missing] });
      }

      const actor = this.actorOf(customer);
      await this.record({
        actor,
        action: 'booking.held',
        bookingId: booking.row.id,
        metadata: {
          showtimeId: context.view.id,
          seatCount: labels.length,
          channel: 'online',
          holder: customer ? 'customer' : 'guest',
        },
      });
      await this.announceReleases(released.rows, released.claims, actor, 'replaced', {
        showtimeId: context.view.id,
        labels,
      });
      await this.events.publishAfterCommit({
        type: 'seat.held',
        showtimeId: context.view.id,
        labels,
        heldUntil: holdExpiresAt,
      });

      return {
        booking: toBooking({
          row: booking.row,
          seats: booking.seats,
          showtime: context.header,
          latestSale: null,
          qrCode: null,
          now,
        }),
        holdCode: code?.code ?? null,
      };
    });
  }

  /**
   * Claims a guest hold for the signed-in customer with its hold code (design §7.3; PRD Seats 3):
   * the booking gets the customer and their contact, its code is cleared, and its expiry stays
   * as it was (signing in does not restart the clock). The customer's other live hold is
   * released. A hold the customer already owns answers as it is, without the code.
   *
   * - Unknown, someone else's, or a code that does not match: `NOT_FOUND`.
   * - The code matches but the hold has ended: `HOLD_EXPIRED`.
   */
  async claim(principal: CustomerPrincipal, reference: string, holdCode: string): Promise<Booking> {
    return this.transactions.run(async () => {
      const now = this.clock.now();
      const customer = await this.lockCustomer(principal.id);
      const found = await this.bookings.findByReference(reference);
      if (!found) throw new AppError('NOT_FOUND');
      if (found.customer_id === customer.id) {
        if (found.status === 'held' && !isLiveHold(holdOf(found), now)) {
          throw new AppError('HOLD_EXPIRED');
        }
        return this.assemble(found, now);
      }
      if (found.customer_id !== null || !holdCodeMatches(holdCode, found.hold_token_hash)) {
        throw new AppError('NOT_FOUND');
      }

      const others = await this.bookings.liveOnlineHoldIdsOfCustomer(customer.id, now);
      const locked = await this.bookings.lockForUpdate([found.id, ...others]);
      const target = locked.find((row) => row.id === found.id);
      if (
        !target ||
        target.customer_id !== null ||
        !holdCodeMatches(holdCode, target.hold_token_hash)
      ) {
        throw new AppError('NOT_FOUND');
      }
      if (!isLiveHold(holdOf(target), now)) throw new AppError('HOLD_EXPIRED');

      const releasing = locked.filter(
        (row) =>
          row.id !== target.id && row.customer_id === customer.id && isLiveHold(holdOf(row), now),
      );
      await this.refuseProcessing(releasing);
      const released = await this.releaseLocked(releasing, now);

      const contact = contactOf(customer);
      const claimed = await this.bookings.assignOwner(target.id, {
        customer_id: customer.id,
        hold_token_hash: null,
        contact_name: contact.name,
        contact_email: contact.email,
        contact_phone: contact.phone,
        updated_at: now,
      });
      const actor: AuditActor = { kind: 'customer', id: customer.id };
      await this.record({
        actor,
        action: 'booking.claimed',
        bookingId: claimed.id,
        metadata: { showtimeId: claimed.showtime_id, seatCount: claimed.seat_count },
      });
      await this.announceReleases(releasing, released, actor, 'replaced');
      return this.assemble(claimed, now);
    });
  }

  /**
   * Releases a hold now (design §7.3 "Releasing"; PRD Seats 4): its seats are free at once and
   * it reads as Abandoned. Its owner, or anyone presenting the code of an unowned hold, may
   * release it; anyone else gets `NOT_FOUND`. A hold that already ended changes nothing; a paid
   * booking is never released by its customer (`ALREADY_PAID`).
   */
  async release(access: HoldAccess, reference: string): Promise<void> {
    await this.transactions.run(async () => {
      const now = this.clock.now();
      const found = await this.bookings.findByReference(reference);
      if (!found || !mayActOn(found, access)) throw new AppError('NOT_FOUND');
      const [locked] = await this.bookings.lockForUpdate([found.id]);
      if (!locked || !mayActOn(locked, access)) throw new AppError('NOT_FOUND');
      if (locked.status !== 'held') throw new AppError('ALREADY_PAID');
      if (!isLiveHold(holdOf(locked), now)) return;
      await this.refuseProcessing([locked]);

      const released = await this.releaseLocked([locked], now);
      const actor: AuditActor =
        access.customerId === undefined
          ? { kind: 'system' }
          : { kind: 'customer', id: access.customerId };
      await this.announceReleases([locked], released, actor, 'released');
    });
  }

  /** Ends these locked live holds now and frees their seats (one claim statement per showtime). */
  private async releaseLocked(rows: readonly BookingRow[], now: Date): Promise<ReleasedClaims[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    await this.bookings.expireHolds(ids, now);
    const claims = releasedClaims(rows, await this.bookings.seatsOf(ids));
    await this.seatClaims.write({ now, release: claims });
    return claims;
  }

  /**
   * The live holds a new hold replaces (design §7.3 step 4): the customer's live online holds,
   * and the live unowned hold whose code was presented. Locked `FOR UPDATE` in id order and
   * checked again under the lock; their hold times end `now`. Their claims are returned for the
   * new hold's claim statement, which frees them.
   */
  private async lockHoldsToRelease(
    customerId: number | null,
    holdCode: string | undefined,
    now: Date,
  ): Promise<HoldsToRelease> {
    const ids =
      customerId === null ? [] : await this.bookings.liveOnlineHoldIdsOfCustomer(customerId, now);
    const hash = holdCodeHash(holdCode);
    const guestHoldId =
      hash === undefined ? undefined : await this.bookings.liveUnownedHoldIdByCodeHash(hash, now);
    if (guestHoldId !== undefined) ids.push(guestHoldId);
    if (ids.length === 0) return { rows: [], claims: [] };

    const rows = (await this.bookings.lockForUpdate(ids)).filter(
      (row) =>
        isLiveHold(holdOf(row), now) &&
        row.channel === 'online' &&
        (row.customer_id === null
          ? holdCodeMatches(holdCode, row.hold_token_hash)
          : row.customer_id === customerId),
    );
    if (rows.length === 0) return { rows: [], claims: [] };
    await this.refuseProcessing(rows);
    await this.bookings.expireHolds(
      rows.map((row) => row.id),
      now,
    );
    return {
      rows,
      claims: releasedClaims(rows, await this.bookings.seatsOf(rows.map((row) => row.id))),
    };
  }

  /** The held seats as the layout read under the hall lock has them; anything else is refused. */
  private async seatsInLayout(hallId: number, labels: readonly string[]): Promise<HallSeat[]> {
    const layout = await this.halls.findLayout(hallId);
    if (!layout)
      throw new AppError('INTERNAL', 'A showtime references a hall that does not exist.');
    const seats = new Map(layoutSeats(layout).map((seat) => [seat.label, seat]));
    const fields = labels.flatMap((label, index) =>
      seats.has(label) ? [] : [{ field: `seats.${index}`, messages: ['Not a seat in this hall.'] }],
    );
    if (fields.length > 0) throw new AppError('VALIDATION_FAILED', undefined, { fields });
    return sortedLabels(labels).map((label) => seats.get(label)!);
  }

  /** The customer, locked (design §7.1 step 4); gone or anonymised is `UNAUTHENTICATED`. */
  private async lockCustomer(customerId: number): Promise<Customer> {
    const customer = await this.customers.findByIdForUpdate(customerId);
    if (!customer || customer.deletedAt !== null) throw new AppError('UNAUTHENTICATED');
    if (customer.status === 'blocked') throw new AppError('ACCOUNT_BLOCKED');
    return customer;
  }

  /** Inserts the held booking and its priced seats; a reference that collides is drawn again. */
  private async insertHold(
    context: ShowtimeContext,
    seats: readonly HallSeat[],
    customer: Customer | null,
    code: NewHoldCode | null,
    holdExpiresAt: Date,
    now: Date,
  ): Promise<InsertedHold> {
    const { prices } = context.view;
    const priced = seats.map((seat) => ({ seat, price: prices[seat.zone] }));
    const contact = customer ? contactOf(customer) : { name: null, email: null, phone: null };
    const row: NewBookingRow = {
      showtime_id: context.view.id,
      status: 'held',
      channel: 'online',
      customer_id: customer?.id ?? null,
      created_by_staff_id: null,
      hold_token_hash: code?.hash ?? null,
      hold_expires_at: holdExpiresAt,
      has_declined_payment: false,
      seat_count: seats.length,
      total_amount: priced.reduce((sum, { price }) => sum + price.amount, 0),
      currency: prices.front.currency,
      contact_name: contact.name,
      contact_email: contact.email,
      contact_phone: contact.phone,
      created_at: now,
      updated_at: now,
    };
    let inserted: BookingRow | undefined;
    for (let draw = 0; draw < REFERENCE_DRAWS && !inserted; draw += 1) {
      inserted = await this.bookings.insertUnlessReferenceTaken(row, drawReference());
    }
    if (!inserted) throw new AppError('INTERNAL', 'No free booking reference was drawn.');
    const seatRows: BookingSeatRow[] = priced.map(({ seat, price }) => ({
      booking_id: inserted.id,
      seat_label: seat.label,
      row_label: seat.rowLabel,
      seat_number: seat.seatNumber,
      zone: seat.zone,
      price: price.amount,
      is_wheelchair: seat.isWheelchair,
    }));
    await this.bookings.insertSeats(seatRows);
    return { row: inserted, seats: seatRows };
  }

  /**
   * Audits each released hold (`booking.released`) and announces its freed seats after commit.
   * Seats the new hold claims again on the same showtime are not announced as released.
   */
  private async announceReleases(
    rows: readonly BookingRow[],
    claims: readonly ReleasedClaims[],
    actor: AuditActor,
    reason: ReleaseReason,
    reclaimed?: ReclaimedSeats,
  ): Promise<void> {
    for (const row of rows) {
      await this.record({
        actor,
        action: 'booking.released',
        bookingId: row.id,
        metadata: {
          showtimeId: row.showtime_id,
          reason,
          holder: row.customer_id === null ? 'guest' : 'customer',
        },
      });
    }
    for (const claim of claims) {
      const kept = new Set(reclaimed?.showtimeId === claim.showtimeId ? reclaimed.labels : []);
      await this.events.publishAfterCommit({
        type: 'seat.released',
        showtimeId: claim.showtimeId,
        labels: claim.labels.filter((label) => !kept.has(label)),
      });
    }
  }

  private async record(event: BookingAuditEvent): Promise<void> {
    await this.audit.record({
      actor: event.actor,
      action: event.action,
      entity: { type: BOOKING_ENTITY, id: event.bookingId },
      bookingId: event.bookingId,
      metadata: event.metadata,
    });
  }

  /**
   * A customer acts as themselves; a guest has no actor row, so the system records it, with
   * `holder: 'guest'` in the metadata so the activity log can say so.
   */
  private actorOf(customer: Customer | null): AuditActor {
    return customer ? { kind: 'customer', id: customer.id } : { kind: 'system' };
  }

  private async assemble(row: BookingRow, now: Date): Promise<Booking> {
    return this.views.of(row, now);
  }

  /**
   * A hold whose payment is still processing is never released, so its seats stay the
   * customer's until the result is in (design §7.3 step 4; PRD Seats 5). Call it with the
   * bookings locked: payment rows are only written under their booking's lock.
   */
  private async refuseProcessing(rows: readonly BookingRow[]): Promise<void> {
    if (rows.length === 0) return;
    const processing = await this.payments.processingSaleBookingIds(rows.map((row) => row.id));
    if (processing.size > 0) throw new AppError('PAYMENT_IN_PROGRESS');
  }
}

function holdOf(row: BookingRow): HoldTiming {
  return { status: row.status, holdExpiresAt: row.hold_expires_at };
}

/** True when the caller owns the booking, or presents the code of an unowned hold. */
function mayActOn(row: BookingRow, access: HoldAccess): boolean {
  if (row.customer_id !== null) return access.customerId === row.customer_id;
  return holdCodeMatches(access.holdCode, row.hold_token_hash);
}

function contactOf(customer: Customer): BookingContact {
  return { name: customer.fullName, email: customer.email, phone: customer.phone };
}

/** The claims of these bookings, one entry per booking, labels in claim order. */
function releasedClaims(
  rows: readonly BookingRow[],
  seats: readonly BookingSeatRow[],
): ReleasedClaims[] {
  return rows.map((row) => ({
    showtimeId: row.showtime_id,
    bookingId: row.id,
    labels: seats.filter((seat) => seat.booking_id === row.id).map((seat) => seat.seat_label),
  }));
}
