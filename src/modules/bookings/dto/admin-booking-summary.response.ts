import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { MoneyResponse } from '../../../common/money/dto/money-response.dto';

/** The Refunded card: bookings refunded in the last 7 days and what they got back. */
@ApiSchema({ name: 'RefundedCard' })
export class RefundedCardResponse {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 3,
    description: 'Bookings refunded in the 7 days before `serverTime`.',
  })
  bookingCount!: number;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description:
      'What their cancellations gave back, online and at the counter (pending counter refunds included).',
  })
  amount!: MoneyResponse;
}

/** `GET /admin/bookings/summary`: the four cards of the Bookings page (PRD A6). */
@ApiSchema({ name: 'AdminBookingSummary' })
export class AdminBookingSummaryResponse {
  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description:
      'Today: the cinema day of `serverTime` (06:00 to 06:00 Cairo time). Filter the list to it with `dateFrom` and `dateTo`.',
  })
  cinemaDate!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T19:00:12+03:00',
    description: 'When the cards were computed.',
  })
  serverTime!: string;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 42,
    description:
      'Today: bookings made today that were paid (now confirmed, completed or refunded).',
  })
  todayBookings!: number;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description:
      'Today: "collected", money taken today minus refunds paid out today, counted on the day the money moved (online refunds at once, counter refunds when paid out). Can be negative on a day of many refunds.',
  })
  collectedToday!: MoneyResponse;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 2,
    description: 'Failed payments today: online payments declined today.',
  })
  failedPaymentsToday!: number;

  @ApiProperty({
    type: () => RefundedCardResponse,
    nullable: false,
    description: 'Refunded, last 7 days.',
  })
  refundedLast7Days!: RefundedCardResponse;
}
