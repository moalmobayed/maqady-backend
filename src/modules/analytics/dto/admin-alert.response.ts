import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { NamedRefResponse } from '../../bookings/dto/booking-showtime.response';
import { ALERT_KINDS } from '../enums';
import type { AlertKind } from '../types';

/** `failed-payments`: online payments that failed on today's cinema day. */
@ApiSchema({ name: 'FailedPaymentsAlert' })
export class FailedPaymentsAlertResponse {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 6,
    description:
      'Online charges (card, wallet) declined, or closed by the customer at the wallet, today. Open the Payments screen with `status=failed` and today as the period.',
  })
  count!: number;
}

/** `low-sales`: a showtime later today under 35% sold. */
@ApiSchema({ name: 'LowSalesAlert' })
export class LowSalesAlertResponse {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    example: 81,
    description: 'The showtime: open its manage panel with `GET /admin/showtimes/{id}`.',
  })
  showtimeId!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T23:30:00+03:00',
    description: 'Starts at (after now: a started showtime is no longer an alert).',
  })
  startsAt!: string;

  @ApiProperty({
    type: () => NamedRefResponse,
    nullable: false,
    description: 'The movie: id and title (`name`).',
  })
  movie!: NamedRefResponse;

  @ApiProperty({ type: () => NamedRefResponse, nullable: false, description: 'The theater.' })
  theater!: NamedRefResponse;

  @ApiProperty({ type: () => NamedRefResponse, nullable: false, description: 'The hall.' })
  hall!: NamedRefResponse;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 54,
    description: 'Seats in Confirmed bookings.',
  })
  ticketsSold!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 192,
    description: 'Seats on sale.',
  })
  seatCapacity!: number;

  @ApiProperty({
    type: Number,
    nullable: false,
    minimum: 0,
    maximum: 0.35,
    example: 0.2813,
    description: 'Tickets sold ÷ seats, a ratio with 4 decimals (always under 0.35 here).',
  })
  soldShare!: number;
}

/** `hall-gap`: an active hall with no showtime on an open cinema day of the next 7. */
@ApiSchema({ name: 'HallGapAlert' })
export class HallGapAlertResponse {
  @ApiProperty({
    type: () => NamedRefResponse,
    nullable: false,
    description: 'The hall with nothing scheduled.',
  })
  hall!: NamedRefResponse;

  @ApiProperty({
    type: () => NamedRefResponse,
    nullable: false,
    description:
      "Its theater: open its timeline with `GET /admin/showtimes?theaterId=&date=` on the alert's `cinemaDate`.",
  })
  theater!: NamedRefResponse;
}

/** One alert of the bell (design §13.3). Exactly one of the three facts objects is set. */
@ApiSchema({ name: 'AdminAlert' })
export class AdminAlertResponse {
  @ApiProperty({
    type: String,
    nullable: false,
    maxLength: 200,
    pattern: '^[a-z0-9:-]{1,200}$',
    example: 'failed-payments:2026-10-16:6',
    description:
      'The stable key: `failed-payments:<cinemaDate>:<count>`, `low-sales:<showtimeId>` or `hall-gap:<hallId>:<cinemaDate>`. The same condition always has the same key, so it is listed once and stays read once read; a new failed payment changes the count in the key, so that alert is unread again. Send it to `POST /admin/alert-reads`.',
  })
  key!: string;

  @ApiProperty({
    enum: ALERT_KINDS,
    enumName: 'AlertKind',
    nullable: false,
    example: 'failed_payments',
    description:
      '`failed_payments` (online payments failed today), `low_sales` (a showtime later today under 35% sold) or `hall_gap` (a hall with no showtimes on a day of the next 7).',
  })
  kind!: AlertKind;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description: 'The cinema day the alert is about.',
  })
  cinemaDate!: string;

  @ApiProperty({
    type: String,
    nullable: false,
    example: '6 online payments failed today',
    description: 'A line to show as is, in English.',
  })
  title!: string;

  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: false,
    description: 'True once the signed-in staff member has marked this key read.',
  })
  read!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'When they first marked it read; null while unread.',
  })
  readAt!: string | null;

  @ApiProperty({
    type: () => FailedPaymentsAlertResponse,
    nullable: true,
    description: 'Set for `failed_payments`, else null.',
  })
  failedPayments!: FailedPaymentsAlertResponse | null;

  @ApiProperty({
    type: () => LowSalesAlertResponse,
    nullable: true,
    description: 'Set for `low_sales`, else null.',
  })
  lowSales!: LowSalesAlertResponse | null;

  @ApiProperty({
    type: () => HallGapAlertResponse,
    nullable: true,
    description: 'Set for `hall_gap`, else null.',
  })
  hallGap!: HallGapAlertResponse | null;
}

/** `GET /admin/alerts`: a page of the panel, with the bell's count. */
@ApiSchema({ name: 'AdminAlertPage' })
export class AdminAlertPageResponse {
  @ApiProperty({
    type: () => AdminAlertResponse,
    isArray: true,
    nullable: false,
    description:
      'Unread first; then failed payments, low sales (soonest show first), hall gaps (soonest day first, then theater and hall by name).',
  })
  items!: AdminAlertResponse[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Pass back as `cursor` for the next page; null on the last page.',
  })
  nextCursor!: string | null;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 4,
    description: 'How many alerts are current.',
  })
  total!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 3,
    description: "The bell's badge: current alerts the signed-in staff member has not read.",
  })
  unreadCount!: number;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description: "Today's cinema date.",
  })
  cinemaDate!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T15:10:00+03:00',
    description: 'When the alerts were computed.',
  })
  serverTime!: string;
}

/** `POST /admin/alert-reads`: what was marked and the bell after it. */
@ApiSchema({ name: 'AlertReadResult' })
export class AlertReadResultResponse {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 2,
    description:
      'Keys newly marked read. Keys already read, and keys that are not current alerts, are not counted.',
  })
  markedCount!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 1,
    description: "The bell's badge after marking.",
  })
  unreadCount!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 4,
    description: 'How many alerts are current.',
  })
  total!: number;
}
