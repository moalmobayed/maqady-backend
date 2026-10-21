import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { MoneyResponse } from '../../../common/money/dto/money-response.dto';
import { BOOKING_CHANNELS, BOOKING_DISPLAY_STATUSES, HOLD_OWNERS } from '../enums';
import type { BookingChannel, BookingDisplayStatus, HoldOwner } from '../types';
import { BookingSeatResponse } from './booking-seat.response';
import { BookingShowtimeResponse } from './booking-showtime.response';

/**
 * A booking as its holder sees it (design §7.4, §11). Checkout and My Bookings (U11, U12) add
 * their fields to this schema.
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
      '`guest`: held while signed out, reachable only with its hold code until a customer claims it (`POST /holds/{ref}/claims`). `customer`: owned by a customer account.',
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
}
