import { ApiProperty } from '@nestjs/swagger';
import { BATCH_RESULTS } from '../enums';
import type { BatchResult } from '../types';
import { AdminShowtimeResponse } from './admin-showtime.response';
import { ShowtimeConflictResponse } from './showtime-conflict.response';

/** What happened to one date of a batch create. */
export class BatchItemResponse {
  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description: 'The cinema date.',
  })
  cinemaDate!: string;

  @ApiProperty({
    enum: BATCH_RESULTS,
    enumName: 'ShowtimeBatchResult',
    nullable: false,
    example: 'created',
    description:
      '`created`, or the check that kept the date out (as in the dry run): `time_does_not_exist`, `in_past`, `outside_opening_hours` or `conflict`.',
  })
  result!: BatchResult;

  @ApiProperty({
    type: () => AdminShowtimeResponse,
    nullable: true,
    description: 'The new showtime; null unless `created`.',
  })
  showtime!: AdminShowtimeResponse | null;

  @ApiProperty({
    type: () => ShowtimeConflictResponse,
    isArray: true,
    nullable: false,
    description: 'The showtimes in the way; empty unless `conflict`.',
  })
  conflicts!: ShowtimeConflictResponse[];
}

/** `POST /admin/showtimes`: every requested date, in date order. */
export class ShowtimeBatchResponse {
  @ApiProperty({
    type: () => BatchItemResponse,
    isArray: true,
    nullable: false,
    description: 'One per date, in date order.',
  })
  results!: BatchItemResponse[];

  @ApiProperty({ type: 'integer', minimum: 1, example: 3, description: 'Dates created.' })
  createdCount!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    example: 2,
    description: 'Dates skipped (only with `skipUnavailable: true`).',
  })
  skippedCount!: number;
}
