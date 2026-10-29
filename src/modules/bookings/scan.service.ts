import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { StaffPrincipal } from '../../common/auth/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { TheaterReadService } from '../theaters/theater-read.service';
import { BookingShowtimeService } from './booking-showtime.service';
import { bookingStatusOf } from './booking-status.sql';
import { BOOKING_CHECKED_IN_ACTION, BOOKING_ENTITY } from './bookings.constants';
import { BookingsRepository } from './bookings.repository';
import { QrCodeService } from './qr-code.service';
import { scanVerdict } from './scan-verdict';
import type {
  BookingRow,
  ScanInput,
  ScanOutcome,
  ScanReason,
  ScanResult,
  ScannedBooking,
  ShowtimeContext,
} from './types';

/** The results that show how many people the booking admits. */
const ADMITTING_RESULTS: readonly ScanResult[] = ['VALID', 'ALREADY_USED', 'CONFIRM_REQUIRED'];

/**
 * Ticket scanning at the entrance (design §7.9; PRD "Scan tickets", "Tickets and QR codes"). A
 * scan names the theater the scanner stands in and the ticket: a QR payload (its signature
 * verified, its version compared with the booking's) or a typed reference, which admits only on
 * a second request with `confirm: true`. Every outcome is a result (`scanVerdict()`), never an
 * error; only an unknown theater is `NOT_FOUND`.
 *
 * Admission is one conditional update (`checked_in_at IS NULL`, still `confirmed`, the presented
 * QR version), taken after the showtime's `FOR SHARE` lock (design §7.1 steps 2 then 5), so two
 * scans of one ticket admit it exactly once and a move or cancellation cannot change the window
 * between the verdict and the admission. A refused scan writes nothing; an admission is audited.
 * Naturally idempotent: a repeat answers `ALREADY_USED` with the first scan's time.
 */
@Injectable()
export class ScanService {
  constructor(
    private readonly theaters: TheaterReadService,
    private readonly qrCodes: QrCodeService,
    private readonly bookings: BookingsRepository,
    private readonly showtimes: BookingShowtimeService,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async scan(staff: StaffPrincipal, input: ScanInput): Promise<ScanOutcome> {
    return this.transactions.run(async () => {
      const now = this.clock.now();
      const theater = await this.theaters.findById(input.theaterId);
      if (!theater) throw new AppError('NOT_FOUND');

      const presented = this.presented(input);
      const found = presented && (await this.bookings.findByReference(presented.reference));
      if (!presented || !found) return notFound(now);

      const context = await this.showtimes.lockedBookingContext(found.showtime_id);
      const verdict = this.verdictOf(input, found, presented.version, context, now);
      if (!verdict.admit) {
        return this.outcome(found, context, verdict.result, verdict.reason, null, now);
      }

      const checkedInAt = await this.bookings.checkIn(found.id, presented.version, staff.id, now);
      if (checkedInAt) {
        await this.audit.record({
          actor: { kind: 'staff', id: staff.id },
          action: BOOKING_CHECKED_IN_ACTION,
          entity: { type: BOOKING_ENTITY, id: found.id },
          bookingId: found.id,
          metadata: { theaterId: input.theaterId, via: input.via },
        });
        return this.outcome(found, context, 'VALID', null, checkedInAt, now);
      }

      // Another scan, a refund or an edit changed the row while this one waited on it: answer
      // what the row says now. Its verdict can no longer admit.
      const fresh = await this.bookings.findByReference(found.reference);
      if (!fresh) throw new AppError('INTERNAL', 'A scanned booking disappeared.');
      const again = this.verdictOf(input, fresh, presented.version, context, now);
      if (again.admit) {
        throw new AppError('INTERNAL', 'A booking refused admission still reads as admissible.');
      }
      return this.outcome(fresh, context, again.result, again.reason, null, now);
    });
  }

  /** The reference and QR version presented; null when a code is not a genuine Maqady ticket. */
  private presented(input: ScanInput): { reference: string; version: number | null } | null {
    if (input.via === 'reference') return { reference: input.reference, version: null };
    const payload = this.qrCodes.verify(input.code);
    return payload ? { reference: payload.reference, version: payload.version } : null;
  }

  private verdictOf(
    input: ScanInput,
    row: BookingRow,
    presentedVersion: number | null,
    context: ShowtimeContext,
    now: Date,
  ) {
    return scanVerdict(
      {
        theaterId: input.theaterId,
        showtime: {
          theaterId: context.view.theaterId,
          status: context.view.status,
          startsAt: context.view.startsAt,
          endsAt: context.view.endsAt,
        },
        booking: {
          status: row.status,
          qrVersion: row.qr_version,
          checkedInAt: row.checked_in_at,
        },
        presentedVersion,
        via: input.via,
        confirm: input.via === 'reference' && input.confirm,
      },
      now,
    );
  }

  /** The scanner's answer about a booking it found. */
  private async outcome(
    row: BookingRow,
    context: ShowtimeContext,
    result: ScanResult,
    reason: ScanReason | null,
    admittedNow: Date | null,
    now: Date,
  ): Promise<ScanOutcome> {
    return {
      result,
      reason,
      admits: ADMITTING_RESULTS.includes(result) ? row.seat_count : null,
      checkedInAt:
        result === 'VALID' ? admittedNow : result === 'ALREADY_USED' ? row.checked_in_at : null,
      scannedAt: now,
      booking: await this.scannedBooking(row, context, now),
    };
  }

  private async scannedBooking(
    row: BookingRow,
    context: ShowtimeContext,
    now: Date,
  ): Promise<ScannedBooking> {
    const seats = await this.bookings.seatsOf([row.id]);
    return {
      reference: row.reference,
      status: bookingStatusOf(
        {
          status: row.status,
          holdExpiresAt: row.hold_expires_at,
          hasDeclinedPayment: row.has_declined_payment,
          showtimeEndsAt: context.view.endsAt,
        },
        now,
      ),
      seats: seats.map((seat) => seat.seat_label),
      seatCount: row.seat_count,
      contactName: row.contact_name,
      showtime: context.header,
    };
  }
}

function notFound(now: Date): ScanOutcome {
  return {
    result: 'NOT_FOUND',
    reason: null,
    admits: null,
    checkedInAt: null,
    scannedAt: now,
    booking: null,
  };
}
