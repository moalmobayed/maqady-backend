import { ApiProperty } from '@nestjs/swagger';
import { HALL_STATUSES } from '../../halls/enums';
import type { HallStatus } from '../../halls/types';
import { AdminShowtimeResponse } from './admin-showtime.response';
import { ShowtimeTheaterRefResponse } from './admin-showtime-detail.response';
import { OpeningWindowResponse } from './opening-window.response';

/** One hall row of the timeline. */
export class TimelineHallResponse {
  @ApiProperty({ type: 'integer', example: 3, description: 'Hall id.' })
  id!: number;

  @ApiProperty({ type: String, nullable: false, example: 'Hall 3', description: 'Hall name.' })
  name!: string;

  @ApiProperty({
    enum: HALL_STATUSES,
    enumName: 'HallStatus',
    nullable: false,
    example: 'active',
    description:
      'Only `active` halls can be scheduled; others appear when they have a showtime that date.',
  })
  status!: HallStatus;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    example: 190,
    description: 'Seats in its layout now.',
  })
  seatCount!: number;
}

/** `GET /admin/showtimes`: one theater's cinema date on the scheduling timeline (PRD A5). */
export class ShowtimeTimelineResponse {
  @ApiProperty({ type: () => ShowtimeTheaterRefResponse, description: 'The theater.' })
  theater!: ShowtimeTheaterRefResponse;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description: 'The cinema date.',
  })
  cinemaDate!: string;

  @ApiProperty({
    type: () => OpeningWindowResponse,
    nullable: true,
    description: 'Opening hours that date; null when closed or without hours.',
  })
  window!: OpeningWindowResponse | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description:
      'The special date setting these hours, such as "Armed Forces Day"; null for weekly hours.',
  })
  specialDateLabel!: string | null;

  @ApiProperty({
    type: () => TimelineHallResponse,
    isArray: true,
    nullable: false,
    description:
      'The rows: every active hall, and any other hall with a showtime that date, by name.',
  })
  halls!: TimelineHallResponse[];

  @ApiProperty({
    type: () => AdminShowtimeResponse,
    isArray: true,
    nullable: false,
    description: 'This page of the showtimes, scheduled and cancelled, by start.',
  })
  items!: AdminShowtimeResponse[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Pass as `cursor` to get the next page; null on the last page.',
  })
  nextCursor!: string | null;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    example: 6,
    description: 'Showtimes that date, with the same filters.',
  })
  total!: number;
}
