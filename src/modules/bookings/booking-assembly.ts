import { money } from '../../common/money/money';
import { bookingStatusOf } from './booking-status.sql';
import type { Booking, BookingParts } from './types';

/** A booking as the API shows it, from its row, its seats and its showtime, judged at `now`. */
export function toBooking({ row, seats, showtime, now }: BookingParts): Booking {
  return {
    id: row.id,
    reference: row.reference,
    status: bookingStatusOf(
      {
        status: row.status,
        holdExpiresAt: row.hold_expires_at,
        hasDeclinedPayment: row.has_declined_payment,
        showtimeEndsAt: showtime.endsAt,
      },
      now,
    ),
    channel: row.channel,
    owner: row.customer_id === null ? 'guest' : 'customer',
    customerId: row.customer_id,
    showtime,
    seats: seats
      .filter((seat) => seat.booking_id === row.id)
      .map((seat) => ({
        label: seat.seat_label,
        rowLabel: seat.row_label,
        seatNumber: seat.seat_number,
        zone: seat.zone,
        price: money(seat.price, row.currency),
        isWheelchair: seat.is_wheelchair,
      })),
    seatCount: row.seat_count,
    total: money(row.total_amount, row.currency),
    holdExpiresAt: row.hold_expires_at,
    serverTime: now,
    createdAt: row.created_at,
  };
}
