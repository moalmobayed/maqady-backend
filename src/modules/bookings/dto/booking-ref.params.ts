import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { REFERENCE_PATTERN } from '../bookings.constants';

/** `/holds/{ref}`, `/bookings/{ref}`: a booking reference, never an internal id (design §7.9). */
export class BookingRefParams {
  @ApiProperty({
    type: String,
    nullable: false,
    pattern: REFERENCE_PATTERN.source,
    example: 'MQ-7K3P9Q',
    description:
      'Booking reference: `MQ-` and 6 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (upper case; no 0, O, 1, I or L).',
  })
  @Matches(REFERENCE_PATTERN, {
    message: 'ref must be a booking reference such as MQ-7K3P9Q',
  })
  ref!: string;
}
