import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { MoneyResponse } from '../../../common/money/dto/money-response.dto';
import { PageResponseOf } from '../../../common/pagination/dto/page-response.dto';
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
import { BookingContactResponse } from './admin-booking.response';
import { BookingShowtimeResponse } from './booking-showtime.response';
import { PaymentResponse } from './payment.response';

/**
 * One row of the admin bookings table (PRD A6): BOOKING, CUSTOMER, MOVIE, SHOWTIME, SEATS, TOTAL,
 * PAYMENT, STATUS and the Channel column.
 */
@ApiSchema({ name: 'AdminBookingListItem' })
export class AdminBookingListItemResponse {
  @ApiProperty({
    type: String,
    nullable: false,
    pattern: '^MQ-[2-9A-HJKMNP-Z]{6}$',
    example: 'MQ-7K3P9Q',
    description: 'Booking reference; open the detail with `GET /admin/bookings/{ref}`.',
  })
  reference!: string;

  @ApiProperty({
    enum: BOOKING_DISPLAY_STATUSES,
    enumName: 'BookingStatus',
    nullable: false,
    example: 'confirmed',
    description: 'Decided now from stored times, as on `Booking.status`.',
  })
  status!: BookingDisplayStatus;

  @ApiProperty({
    enum: PAYMENT_STATUS_DISPLAYS,
    enumName: 'BookingPaymentStatus',
    nullable: false,
    example: 'paid',
    description: '`unpaid`, `processing`, `declined`, `paid` or `refunded`.',
  })
  paymentStatus!: PaymentStatusDisplay;

  @ApiProperty({
    enum: BOOKING_CHANNELS,
    enumName: 'BookingChannel',
    nullable: false,
    example: 'online',
    description: 'The Channel column: `online` or `counter`.',
  })
  channel!: BookingChannel;

  @ApiProperty({
    enum: HOLD_OWNERS,
    enumName: 'BookingOwner',
    nullable: false,
    example: 'customer',
    description:
      '`customer` (an account), `guest` (an unclaimed online hold) or `staff` (a counter booking without an account).',
  })
  owner!: HoldOwner;

  @ApiProperty({
    type: () => BookingContactResponse,
    nullable: false,
    description: 'The CUSTOMER column: the contact on the booking.',
  })
  contact!: BookingContactResponse;

  @ApiProperty({
    type: () => BookingShowtimeResponse,
    nullable: false,
    description: 'The MOVIE and SHOWTIME columns.',
  })
  showtime!: BookingShowtimeResponse;

  @ApiProperty({
    type: String,
    isArray: true,
    nullable: false,
    example: ['F7', 'F8'],
    description: 'The seats, in seat order.',
  })
  seatLabels!: string[];

  @ApiProperty({ type: 'integer', nullable: false, example: 2, description: 'Number of seats.' })
  seatCount!: number;

  @ApiProperty({ type: () => MoneyResponse, nullable: false, description: 'The total.' })
  total!: MoneyResponse;

  @ApiProperty({
    type: () => PaymentResponse,
    nullable: true,
    description: 'The latest sale payment (method and result); null before the first attempt.',
  })
  payment!: PaymentResponse | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T19:00:00+03:00',
    description: 'When the booking was made (the list is newest first).',
  })
  createdAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-16T19:02:10+03:00',
    description: 'When it was paid; null while held, failed or abandoned.',
  })
  confirmedAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'When it was scanned at the entrance; null until then.',
  })
  checkedInAt!: string | null;
}

/** `GET /admin/bookings`: one page, newest first. */
export const AdminBookingListItemPageResponse = PageResponseOf(AdminBookingListItemResponse);
