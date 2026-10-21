import { ApiProperty } from '@nestjs/swagger';
import { CHECK_RESULTS } from '../enums';
import type { CheckResult } from '../types';
import { ShowtimeHallRefResponse, ShowtimeMovieRefResponse } from './admin-showtime.response';
import { OpeningWindowResponse } from './opening-window.response';
import { ShowtimeConflictResponse } from './showtime-conflict.response';
import { SuggestedStartResponse } from './suggested-start.response';

/** The checks of one requested cinema date: one date chip of the scheduling dialog. */
export class DateCheckResponse {
  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description: 'The cinema date.',
  })
  cinemaDate!: string;

  @ApiProperty({
    enum: CHECK_RESULTS,
    enumName: 'ShowtimeCheckResult',
    nullable: false,
    example: 'available',
    description:
      'The first check that fails, in this order: `time_does_not_exist` (the clocks skip the start that night, summer time), `in_past`, `outside_opening_hours` (also a closed date or one without hours), `conflict` (closer than 20 minutes to another showtime in the hall); else `available`.',
  })
  result!: CheckResult;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-16T19:30:00+03:00',
    description: 'The start; null for `time_does_not_exist`.',
  })
  startsAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-16T21:38:00+03:00',
    description: 'The end; null for `time_does_not_exist`.',
  })
  endsAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-16T21:58:00+03:00',
    description: 'When the cleaning after it ends; null for `time_does_not_exist`.',
  })
  cleaningEndsAt!: string | null;

  @ApiProperty({
    type: () => OpeningWindowResponse,
    nullable: true,
    description:
      "The date's opening hours; null when the theater is closed or has no hours that date.",
  })
  window!: OpeningWindowResponse | null;

  @ApiProperty({
    type: () => ShowtimeConflictResponse,
    isArray: true,
    nullable: false,
    description: 'The showtimes it would overlap, cleaning included; empty unless `conflict`.',
  })
  conflicts!: ShowtimeConflictResponse[];

  @ApiProperty({
    type: () => SuggestedStartResponse,
    isArray: true,
    nullable: false,
    description:
      'Up to 3 free starts that pass every check, on the 5-minute grid, nearest to the requested time first; empty for an `available` date or when nothing fits.',
  })
  suggestions!: SuggestedStartResponse[];
}

/** `POST /admin/showtime-checks`: whether each date fits, before anything is created. */
export class ShowtimeCheckResponse {
  @ApiProperty({ type: () => ShowtimeMovieRefResponse, description: 'The movie.' })
  movie!: ShowtimeMovieRefResponse;

  @ApiProperty({ type: () => ShowtimeHallRefResponse, description: 'The hall.' })
  hall!: ShowtimeHallRefResponse;

  @ApiProperty({ type: 'integer', example: 1, description: "The hall's theater." })
  theaterId!: number;

  @ApiProperty({
    type: String,
    nullable: false,
    example: '19:30',
    description: 'The requested start time.',
  })
  startTime!: string;

  @ApiProperty({
    type: () => DateCheckResponse,
    isArray: true,
    nullable: false,
    description: 'One per requested date, in date order.',
  })
  results!: DateCheckResponse[];
}
