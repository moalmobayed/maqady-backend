import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { MoneyResponse } from '../../../common/money/dto/money-response.dto';
import { BOOKING_CHANNELS, BOOKING_DISPLAY_STATUSES, PAYMENT_STATUS_DISPLAYS } from '../enums';
import type { BookingChannel, BookingDisplayStatus, PaymentStatusDisplay } from '../types';
import { BookingRefundResponse } from './booking-refund.response';
import { BookingShowtimeResponse } from './booking-showtime.response';
import { PaymentResponse } from './payment.response';

/** One card of My Bookings (PRD C10): the showtime, the seats, the total and the status. */
@ApiSchema({ name: 'MyBooking' })
export class MyBookingResponse {
  @ApiProperty({
    type: String,
    nullable: false,
    pattern: '^MQ-[2-9A-HJKMNP-Z]{6}$',
    example: 'MQ-7K3P9Q',
    description:
      'Booking reference. Open the booking with `GET /bookings/{ref}` and its History with `GET /bookings/{ref}/history`.',
  })
  reference!: string;

  @ApiProperty({
    enum: BOOKING_DISPLAY_STATUSES,
    enumName: 'BookingStatus',
    nullable: false,
    example: 'confirmed',
    description:
      'Decided now from stored times. Upcoming shows only `confirmed`; Past shows `completed` (the showtime ended), `refunded` and `failed` (the hold ended after a declined payment).',
  })
  status!: BookingDisplayStatus;

  @ApiProperty({
    enum: PAYMENT_STATUS_DISPLAYS,
    enumName: 'BookingPaymentStatus',
    nullable: false,
    example: 'paid',
    description:
      'Decided with `status`: `paid` (confirmed or completed), `refunded`, or `declined` (failed).',
  })
  paymentStatus!: PaymentStatusDisplay;

  @ApiProperty({
    enum: BOOKING_CHANNELS,
    enumName: 'BookingChannel',
    nullable: false,
    example: 'online',
    description: '`online` on the website, `counter` at the box office.',
  })
  channel!: BookingChannel;

  @ApiProperty({
    type: () => BookingShowtimeResponse,
    nullable: false,
    description:
      'The showtime: movie with its poster, theater with its address, hall, start, end and `cinemaDate` (a show after midnight belongs to the previous cinema day).',
  })
  showtime!: BookingShowtimeResponse;

  @ApiProperty({
    type: String,
    isArray: true,
    nullable: false,
    example: ['F7', 'F8'],
    description: 'The seats in seat order: by row, then number (`F2` before `F10`).',
  })
  seatLabels!: string[];

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
    description: 'The total paid (or to pay): the sum of the seat prices.',
  })
  total!: MoneyResponse;

  @ApiProperty({
    type: () => PaymentResponse,
    nullable: true,
    description: 'The latest payment attempt, for "Visa •••• 4242"; null for a booking with none.',
  })
  payment!: PaymentResponse | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-15T14:02:10+03:00',
    description: 'When the booking was confirmed (paid); null for a failed booking.',
  })
  confirmedAt!: string | null;

  @ApiProperty({
    type: () => BookingRefundResponse,
    nullable: true,
    description: 'The refund of a `refunded` booking: its amount and date. Null otherwise.',
  })
  refund!: BookingRefundResponse | null;
}

/** How many bookings each tab of My Bookings has, for the tab labels. */
@ApiSchema({ name: 'MyBookingTabCounts' })
export class MyBookingTabCountsResponse {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 2,
    description: 'Upcoming bookings ("Upcoming 2").',
  })
  upcoming!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 5,
    description: 'Past bookings ("Past 5").',
  })
  past!: number;
}

/** `GET /me/bookings`: one page of a tab, with both tabs' counts. */
@ApiSchema({ name: 'MyBookingPage' })
export class MyBookingPageResponse {
  @ApiProperty({
    type: () => MyBookingResponse,
    isArray: true,
    nullable: false,
    description: 'This page, in the tab order. Empty when the tab has no bookings.',
  })
  items!: MyBookingResponse[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'WyIyMDI2LTEwLTE2VDE2OjMwOjAwLjAwMFoiLDQyXQ',
    description: 'Pass as `cursor` (with the same `tab`) to get the next page; null on the last.',
  })
  nextCursor!: string | null;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 2,
    description: 'How many bookings this tab has.',
  })
  total!: number;

  @ApiProperty({
    type: () => MyBookingTabCountsResponse,
    nullable: false,
    description: 'Both tabs’ totals, for the tab labels.',
  })
  tabCounts!: MyBookingTabCountsResponse;
}
