import { ApiProperty } from '@nestjs/swagger';

/** A scheduled showtime another one would come closer than 20 minutes to. */
export class ShowtimeConflictResponse {
  @ApiProperty({ type: 'integer', example: 81, description: 'The showtime in the way.' })
  showtimeId!: number;

  @ApiProperty({
    type: String,
    nullable: false,
    example: 'The Nile Light',
    description: 'Its movie.',
  })
  movieTitle!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T19:30:00+03:00',
    description: 'Its start, Cairo time.',
  })
  startsAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T21:38:00+03:00',
    description: 'Its end.',
  })
  endsAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T21:58:00+03:00',
    description: 'When its cleaning ends.',
  })
  cleaningEndsAt!: string;
}
