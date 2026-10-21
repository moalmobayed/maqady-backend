import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { toBooking } from './booking-assembly';
import { BookingShowtimeService } from './booking-showtime.service';
import { isLiveHold } from './booking-status.sql';
import { BookingsRepository } from './bookings.repository';
import { holdCodeMatches } from './hold-code';
import type { Booking, BookingRow, HoldAccess } from './types';

/**
 * Bookings as their holder reads them (design §10.4, §11 `GET /bookings/{ref}`): the owner in
 * any status, or anyone with the hold code while an unowned hold is live. Anyone else, including
 * a guest whose hold ended, gets `NOT_FOUND`, never `FORBIDDEN`, and the check comes before
 * anything else is read. Exported for checkout and My Bookings (U11, U12).
 */
@Injectable()
export class BookingReadService {
  constructor(
    private readonly bookings: BookingsRepository,
    private readonly showtimes: BookingShowtimeService,
    private readonly clock: Clock,
  ) {}

  async get(reference: string, access: HoldAccess): Promise<Booking> {
    const now = this.clock.now();
    const row = await this.bookings.findByReference(reference);
    if (!row || !mayRead(row, access, now)) throw new AppError('NOT_FOUND');
    const seats = await this.bookings.seatsOf([row.id]);
    const context = await this.showtimes.bookingContext(row.showtime_id);
    return toBooking({ row, seats, showtime: context.header, now });
  }
}

function mayRead(row: BookingRow, access: HoldAccess, now: Date): boolean {
  if (row.customer_id !== null) return access.customerId === row.customer_id;
  return (
    isLiveHold({ status: row.status, holdExpiresAt: row.hold_expires_at }, now) &&
    holdCodeMatches(access.holdCode, row.hold_token_hash)
  );
}
