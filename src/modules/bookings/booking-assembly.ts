import { money } from '../../common/money/money';
import { bookingStatusOf, paymentStatusOf } from './booking-status.sql';
import { TICKET_STATUSES } from './enums';
import { seatLinesOf } from './seat-lines';
import type { Booking, BookingDisplayStatus, BookingParts, BookingSeat } from './types';

/** A booking as the API shows it, from its row, its seats and its showtime, judged at `now`. */
export function toBooking({
  row,
  seats,
  showtime,
  latestSale,
  qrCode,
  now,
}: BookingParts): Booking {
  const status = bookingStatusOf(
    {
      status: row.status,
      holdExpiresAt: row.hold_expires_at,
      hasDeclinedPayment: row.has_declined_payment,
      showtimeEndsAt: showtime.endsAt,
    },
    now,
  );
  const ownSeats: BookingSeat[] = seats
    .filter((seat) => seat.booking_id === row.id)
    .map((seat) => ({
      label: seat.seat_label,
      rowLabel: seat.row_label,
      seatNumber: seat.seat_number,
      zone: seat.zone,
      price: money(seat.price, row.currency),
      isWheelchair: seat.is_wheelchair,
    }));
  const total = money(row.total_amount, row.currency);
  return {
    id: row.id,
    reference: row.reference,
    status,
    channel: row.channel,
    owner: row.customer_id !== null ? 'customer' : row.channel === 'counter' ? 'staff' : 'guest',
    customerId: row.customer_id,
    showtime,
    seats: ownSeats,
    seatCount: row.seat_count,
    total,
    holdExpiresAt: row.hold_expires_at,
    serverTime: now,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    paymentStatus: paymentStatusOf({
      status: row.status,
      hasDeclinedPayment: row.has_declined_payment,
      latestSaleStatus: latestSale?.status ?? null,
    }),
    payment: latestSale,
    ticket: hasTicket(status) && qrCode !== null ? { qrCode, admits: row.seat_count } : null,
    seatLines: seatLinesOf(ownSeats),
    // A refund is always the full total (PRD "Statuses": Refunded is a full refund).
    refund:
      row.status === 'refunded' && row.refunded_at !== null
        ? { amount: total, refundedAt: row.refunded_at }
        : null,
  };
}

/** True for the statuses that have a ticket: Confirmed and Completed. */
export function hasTicket(status: BookingDisplayStatus): boolean {
  return (TICKET_STATUSES as readonly string[]).includes(status);
}
