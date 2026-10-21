import { ApiProperty } from '@nestjs/swagger';
import type { RelatedRecordIds } from '../types';

/** What a message is about: the customer, staff member or booking it was sent for. */
export class MessageRelatedResponse {
  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 812,
    description:
      'The customer the message was sent for (verification, reset, tickets); null if none.',
  })
  customerId!: number | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 3,
    description: 'The staff member the message was sent to (invite, staff reset); null if none.',
  })
  staffUserId!: number | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 5120,
    description:
      'The booking the message is about (tickets, refunds, showtime changes); null if none.',
  })
  bookingId!: number | null;

  static from(related: RelatedRecordIds): MessageRelatedResponse {
    return Object.assign(new MessageRelatedResponse(), {
      customerId: related.customerId,
      staffUserId: related.staffUserId,
      bookingId: related.bookingId,
    });
  }
}
