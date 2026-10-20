import { ApiProperty } from '@nestjs/swagger';

/** A free start time the dry run suggests (on the 5-minute grid). */
export class SuggestedStartResponse {
  @ApiProperty({
    type: String,
    nullable: false,
    example: '22:00',
    description: 'Cairo wall-clock start, `HH:mm`, to send as `startTime`.',
  })
  startTime!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T22:00:00+03:00',
    description: 'The same start as an instant.',
  })
  startsAt!: string;
}
