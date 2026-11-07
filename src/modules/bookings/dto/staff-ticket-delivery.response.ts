import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { STAFF_TICKET_CHANNELS } from '../enums';
import type { StaffTicketChannel } from '../types';

/** What "Resend tickets" queued (PRD A6). */
@ApiSchema({ name: 'StaffTicketDelivery' })
export class StaffTicketDeliveryResponse {
  @ApiProperty({
    enum: STAFF_TICKET_CHANNELS,
    enumName: 'StaffTicketChannel',
    isArray: true,
    nullable: false,
    example: ['email', 'sms'],
    description:
      'How the tickets go: `email` to the contact email, `sms` to the contact phone, each when on file.',
  })
  channels!: StaffTicketChannel[];

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T19:10:00+03:00',
    description:
      'When they were queued. They leave within seconds; the Message log shows each delivery.',
  })
  queuedAt!: string;
}
