import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { PaymentsService } from '../payments/payments.service';
import { toBooking } from './booking-assembly';
import { BookingShowtimeService } from './booking-showtime.service';
import { BookingsRepository } from './bookings.repository';
import { QrCodeService } from './qr-code.service';
import type { Booking, BookingRow } from './types';

/**
 * Stored bookings as the API shows them (design §7.4, §7.9): their seats, their showtime headers,
 * their latest sale charges and, once they have a QR version, their signed QR payloads. A fixed
 * number of queries whatever the number of bookings: holds, booking reads and checkout answer
 * through `of()`, My Bookings (U12) through `ofMany()`.
 */
@Injectable()
export class BookingViews {
  constructor(
    private readonly bookings: BookingsRepository,
    private readonly showtimes: BookingShowtimeService,
    private readonly payments: PaymentsService,
    private readonly qrCodes: QrCodeService,
  ) {}

  async of(row: BookingRow, now: Date): Promise<Booking> {
    const [booking] = await this.ofMany([row], now);
    if (!booking) throw new AppError('INTERNAL', 'A booking could not be assembled.');
    return booking;
  }

  /** These bookings, in their order, judged at `now`. */
  async ofMany(rows: readonly BookingRow[], now: Date): Promise<Booking[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    // One after the other: inside a transaction they would share one connection.
    const seats = await this.bookings.seatsOf(ids);
    const headers = await this.showtimes.headersOf(rows.map((row) => row.showtime_id));
    const latestSales = await this.payments.latestSalesOf(ids);
    return rows.map((row) => {
      const showtime = headers.get(row.showtime_id);
      if (!showtime) {
        throw new AppError('INTERNAL', 'A booking references a showtime that does not exist.');
      }
      return toBooking({
        row,
        seats,
        showtime,
        latestSale: latestSales.get(row.id) ?? null,
        qrCode:
          row.qr_version === null ? null : this.qrCodes.payloadFor(row.reference, row.qr_version),
        now,
      });
    });
  }
}
