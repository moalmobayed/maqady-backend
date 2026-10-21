import { Injectable } from '@nestjs/common';
import { PaymentsService } from '../payments/payments.service';
import { toBooking } from './booking-assembly';
import { BookingShowtimeService } from './booking-showtime.service';
import { BookingsRepository } from './bookings.repository';
import { QrCodeService } from './qr-code.service';
import type { Booking, BookingRow } from './types';

/**
 * A stored booking as the API shows it (design §7.4, §7.9): its seats, its showtime header, its
 * latest sale charge and, once it has a QR version, its signed QR payload. A fixed number of
 * queries per booking. Holds, booking reads and checkout answer through it.
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
    // One after the other: inside a transaction they would share one connection.
    const seats = await this.bookings.seatsOf([row.id]);
    const context = await this.showtimes.bookingContext(row.showtime_id);
    const latestSale = (await this.payments.latestSalesOf([row.id])).get(row.id) ?? null;
    return toBooking({
      row,
      seats,
      showtime: context.header,
      latestSale,
      qrCode:
        row.qr_version === null ? null : this.qrCodes.payloadFor(row.reference, row.qr_version),
      now,
    });
  }
}
