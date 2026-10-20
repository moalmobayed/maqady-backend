import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, Max, Min } from 'class-validator';
import { MAX_BATCH_DATES, MAX_DATE_SPAN_DAYS } from '../showtimes.constants';
import { IsCinemaDate, IsStartTime, WithinDateSpan } from './showtime.validators';

/** `POST /admin/showtime-checks`: one movie in one hall at one start time on several dates. */
export class CheckShowtimesRequest {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 12,
    description: 'The movie to schedule. It must be Now showing.',
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  movieId!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 3,
    description: 'The hall to schedule in; its theater follows from it. It must be active.',
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  hallId!: number;

  @ApiProperty({
    type: String,
    format: 'date',
    isArray: true,
    nullable: false,
    minItems: 1,
    maxItems: MAX_BATCH_DATES,
    uniqueItems: true,
    example: ['2026-10-16', '2026-10-17', '2026-10-18'],
    description: `Cinema dates, \`YYYY-MM-DD\`: 1 to ${MAX_BATCH_DATES}, no duplicates, all within ${MAX_DATE_SPAN_DAYS} days. Answered in date order.`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH_DATES)
  @ArrayUnique()
  @IsCinemaDate(true)
  @WithinDateSpan()
  dates!: string[];

  @ApiProperty({
    type: String,
    nullable: false,
    pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
    example: '19:30',
    description:
      'Cairo wall-clock start, 24-hour `HH:mm`, any minute. `06:00`–`23:59` is on the cinema date; `00:00`–`05:59` is after midnight, on the next calendar day (still that cinema date).',
  })
  @IsStartTime()
  startTime!: string;
}
