import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { BOOKING_HISTORY_KINDS } from '../enums';
import type { BookingHistoryKind } from '../types';

/** One event of a booking's History (PRD C11 "History from real events"). */
@ApiSchema({ name: 'BookingHistoryEvent' })
export class BookingHistoryEventResponse {
  @ApiProperty({
    enum: BOOKING_HISTORY_KINDS,
    enumName: 'BookingHistoryKind',
    nullable: false,
    example: 'payment_received',
    description:
      'What happened: `seats_held`, `payment_received`, `refunded`, `changed_by_cinema` (the cinema moved the showtime or edited the booking while it held a ticket) or `tickets_resent`.',
  })
  kind!: BookingHistoryKind;

  @ApiProperty({
    type: String,
    nullable: false,
    example: 'Payment received',
    description:
      'The English label of `kind`: "Seats held", "Payment received", "Refunded", "Changed by the cinema" or "Tickets resent".',
  })
  label!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-15T14:02:10+03:00',
    description: 'When it happened, Cairo time with its offset.',
  })
  occurredAt!: string;
}

/** `GET /bookings/{ref}/history`: one page of a booking's History, oldest first. */
@ApiSchema({ name: 'BookingHistoryEventPage' })
export class BookingHistoryEventPageResponse {
  @ApiProperty({
    type: () => BookingHistoryEventResponse,
    isArray: true,
    nullable: false,
    description: 'This page of events, oldest first.',
  })
  items!: BookingHistoryEventResponse[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'WyIyMDI2LTEwLTE1VDExOjAyOjEwLjAwMFoiLDQyXQ',
    description: 'Pass as `cursor` to get the next page; null on the last page.',
  })
  nextCursor!: string | null;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 3,
    description: 'How many events the whole History has.',
  })
  total!: number;
}
