import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { TICKET_DELIVERY_CHANNELS } from '../enums';
import type { TicketDeliveryChannel } from '../types';

/** "Email again": the tickets email is queued and leaves once the request commits. */
@ApiSchema({ name: 'TicketDelivery' })
export class TicketDeliveryResponse {
  @ApiProperty({
    enum: TICKET_DELIVERY_CHANNELS,
    enumName: 'TicketDeliveryChannel',
    nullable: false,
    example: 'email',
    description:
      'How the tickets are sent: always `email`, to the account email shown by `GET /me` (never SMS).',
  })
  channel!: TicketDeliveryChannel;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-15T14:20:00+03:00',
    description:
      'When the email was queued, Cairo time. It is sent right after; a replay answers the first time.',
  })
  queuedAt!: string;
}
