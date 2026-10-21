import { ApiProperty } from '@nestjs/swagger';

/** When a theater opens and closes on one cinema date. */
export class OpeningWindowResponse {
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T12:00:00+03:00',
    description: 'Opening, Cairo time. A showtime starts at or after it.',
  })
  opensAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-17T01:00:00+03:00',
    description:
      'Closing, Cairo time. A showtime ends at or before it (its cleaning may run past).',
  })
  closesAt!: string;
}
