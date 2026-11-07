import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { MoneyResponse } from '../../../common/money/dto/money-response.dto';
import {
  BOOKING_CHANNELS,
  BOOKING_DISPLAY_STATUSES,
  HOLD_OWNERS,
  PAYMENT_STATUS_DISPLAYS,
} from '../enums';
import type {
  BookingChannel,
  BookingDisplayStatus,
  HoldOwner,
  PaymentStatusDisplay,
} from '../types';
import { BookingRefundResponse } from './booking-refund.response';
import { BookingSeatResponse } from './booking-seat.response';
import { BookingShowtimeResponse } from './booking-showtime.response';
import { PaymentResponse } from './payment.response';
import { SeatLineResponse } from './seat-line.response';
import { TicketResponse } from './ticket.response';

/**
 * A booking as its holder sees it (design §7.4, §7.9, §11): the checkout summary, the
 * confirmation and the booking page, with the seat lines and the refund (U12).
 */
@ApiSchema({ name: 'Booking' })
export class BookingResponse {
  @ApiProperty({
    type: String,
    nullable: false,
    pattern: '^MQ-[2-9A-HJKMNP-Z]{6}$',
    example: 'MQ-7K3P9Q',
    description: 'Booking reference; every booking route names the booking by it.',
  })
  reference!: string;

  @ApiProperty({
    enum: BOOKING_DISPLAY_STATUSES,
    enumName: 'BookingStatus',
    nullable: false,
    example: 'held',
    description:
      'Decided at `serverTime` from stored times: `held` while the hold lasts; `failed` once it ended after a declined payment; `abandoned` once it ended (or was released) otherwise; `confirmed` once paid, `completed` after the showtime ended; `refunded`.',
  })
  status!: BookingDisplayStatus;

  @ApiProperty({
    enum: BOOKING_CHANNELS,
    enumName: 'BookingChannel',
    nullable: false,
    example: 'online',
    description: '`online` on the website, `counter` at the box office.',
  })
  channel!: BookingChannel;

  @ApiProperty({
    enum: HOLD_OWNERS,
    enumName: 'BookingOwner',
    nullable: false,
    example: 'customer',
    description:
      "`guest`: held while signed out, reachable only with its hold code until a customer claims it (`POST /holds/{ref}/claims`). `customer`: owned by a customer account (online, or sold at the counter to an existing customer). `staff`: a counter booking with no customer account: the box office member's hold, then a walk-in or typed-contact sale.",
  })
  owner!: HoldOwner;

  @ApiProperty({
    type: () => BookingShowtimeResponse,
    nullable: false,
    description: 'The showtime.',
  })
  showtime!: BookingShowtimeResponse;

  @ApiProperty({
    type: () => BookingSeatResponse,
    isArray: true,
    nullable: false,
    description: 'The seats, by label, each with its zone and price.',
  })
  seats!: BookingSeatResponse[];

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    maximum: 8,
    example: 2,
    description: 'Number of seats.',
  })
  seatCount!: number;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: 'The sum of the seat prices: exactly what checkout charges. There are no fees.',
  })
  total!: MoneyResponse;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T19:05:00+03:00',
    description:
      'When the hold ends (Cairo time): 5 minutes after it was made, or the showtime start if sooner. Signing in does not restart it. A released hold ends when it was released. Show the countdown against `serverTime`.',
  })
  holdExpiresAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T19:00:12+03:00',
    description: "The server's time when this answer was made, to correct the client's clock.",
  })
  serverTime!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T19:00:00+03:00',
    description: 'When the hold was made.',
  })
  createdAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-16T19:02:10+03:00',
    description: 'When the booking was confirmed (paid); null while held.',
  })
  confirmedAt!: string | null;

  @ApiProperty({
    enum: PAYMENT_STATUS_DISPLAYS,
    enumName: 'BookingPaymentStatus',
    nullable: false,
    example: 'paid',
    description:
      'Decided with `status`: `unpaid`; `processing` while a payment is being confirmed ("Confirming your payment"); `declined` after a declined payment (a `failed` booking once the hold ended); `paid` (confirmed or completed); `refunded`.',
  })
  paymentStatus!: PaymentStatusDisplay;

  @ApiProperty({
    type: () => PaymentResponse,
    nullable: true,
    description:
      'The latest payment attempt, for "EGP 380 · Visa •••• 4242"; null before the first one.',
  })
  payment!: PaymentResponse | null;

  @ApiProperty({
    type: () => TicketResponse,
    nullable: true,
    description:
      'The ticket with its QR code while the booking is `confirmed` or `completed`; null otherwise. The PDF and the calendar file come from `GET /bookings/{ref}/ticket.pdf` and `/calendar.ics`.',
  })
  ticket!: TicketResponse | null;

  @ApiProperty({
    type: () => SeatLineResponse,
    isArray: true,
    nullable: false,
    description:
      'The payment table (PRD C8, C11): one line per zone and price, front to back, each with its seats in seat order, the count, the unit price and the amount.',
  })
  seatLines!: SeatLineResponse[];

  @ApiProperty({
    type: () => BookingRefundResponse,
    nullable: true,
    description:
      'The refund of a `refunded` booking: the amount (the full total) and the date. Null otherwise.',
  })
  refund!: BookingRefundResponse | null;
}
