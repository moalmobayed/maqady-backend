import { ApiProperty } from '@nestjs/swagger';
import { MoneyResponse } from '../../../common/money/dto/money-response.dto';
import { AGE_RATINGS, MOVIE_STATUSES } from '../../catalog/enums';
import type { AgeRating, MovieStatus } from '../../catalog/types';
import { CANCEL_REASONS, SHOWTIME_STATUSES } from '../enums';
import type { CancelReason, ShowtimeStatus } from '../types';
import { ShowtimePricesResponse } from './showtime-prices.response';

/** The movie of a showtime, in any status. */
export class ShowtimeMovieRefResponse {
  @ApiProperty({ type: 'integer', example: 12, description: 'Movie id.' })
  id!: number;

  @ApiProperty({ type: String, nullable: false, example: 'The Nile Light', description: 'Title.' })
  title!: string;

  @ApiProperty({
    enum: MOVIE_STATUSES,
    enumName: 'CatalogMovieStatus',
    nullable: false,
    example: 'now_showing',
    description: 'The movie status now. Only a Now showing movie can be scheduled or moved.',
  })
  status!: MovieStatus;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 128,
    description:
      "The movie's runtime now. A showtime keeps the runtime it was scheduled (or last moved) with: compare `endsAt − startsAt`.",
  })
  runtimeMinutes!: number | null;

  @ApiProperty({
    enum: AGE_RATINGS,
    enumName: 'AgeRating',
    nullable: false,
    example: '12+',
    description: 'Age certificate.',
  })
  ageRating!: AgeRating;
}

/** The hall of a showtime. */
export class ShowtimeHallRefResponse {
  @ApiProperty({ type: 'integer', example: 3, description: 'Hall id.' })
  id!: number;

  @ApiProperty({ type: String, nullable: false, example: 'Hall 3', description: 'Hall name.' })
  name!: string;
}

/** A showtime as the admin timeline and the manage panel show it (PRD A5). */
export class AdminShowtimeResponse {
  @ApiProperty({ type: 'integer', example: 81, description: 'Showtime id.' })
  id!: number;

  @ApiProperty({ type: () => ShowtimeMovieRefResponse, description: 'The movie.' })
  movie!: ShowtimeMovieRefResponse;

  @ApiProperty({ type: 'integer', example: 1, description: 'The theater.' })
  theaterId!: number;

  @ApiProperty({ type: () => ShowtimeHallRefResponse, description: 'The hall.' })
  hall!: ShowtimeHallRefResponse;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T19:30:00+03:00',
    description: 'Start, Cairo time with its offset.',
  })
  startsAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T21:38:00+03:00',
    description:
      'End: the start plus the runtime, in real minutes (a summer-time change never shortens it).',
  })
  endsAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T21:58:00+03:00',
    description:
      'When the hall is clean again: 20 minutes after the end. The next showtime in the hall starts at this time at the earliest.',
  })
  cleaningEndsAt!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description:
      'The cinema date, `YYYY-MM-DD`: a cinema day runs from 06:00 to 06:00 Cairo time, so a 00:30 start belongs to the day before.',
  })
  cinemaDate!: string;

  @ApiProperty({
    type: String,
    nullable: false,
    example: '19:30',
    description: 'The Cairo wall-clock start, `HH:mm`, as an admin enters it.',
  })
  startTime!: string;

  @ApiProperty({
    enum: SHOWTIME_STATUSES,
    enumName: 'ShowtimeStatus',
    nullable: false,
    example: 'scheduled',
    description:
      '`scheduled`: on the timeline (started and ended follow from the clock: `hasStarted`, `hasEnded`). `cancelled`: called off; final, and its slot is free again.',
  })
  status!: ShowtimeStatus;

  @ApiProperty({
    enum: CANCEL_REASONS,
    enumName: 'ShowtimeCancelReason',
    nullable: true,
    example: null,
    description: 'Why it was cancelled; null while scheduled.',
  })
  cancelReason!: CancelReason | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'When it was cancelled; null while scheduled.',
  })
  cancelledAt!: string | null;

  @ApiProperty({ type: () => ShowtimePricesResponse, description: 'Price per seat zone.' })
  prices!: ShowtimePricesResponse;

  @ApiProperty({
    type: () => MoneyResponse,
    description:
      'The "from" price: the cheapest zone among the zones the hall\'s current layout has seats in.',
  })
  fromPrice!: MoneyResponse;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 300,
    example: 190,
    description:
      "Seats for sale: the hall's seat count when scheduled, refreshed for upcoming showtimes when the hall layout is saved.",
  })
  seatCapacity!: number;

  @ApiProperty({ type: Boolean, example: false, description: 'The start has passed.' })
  hasStarted!: boolean;

  @ApiProperty({ type: Boolean, example: false, description: 'The end has passed.' })
  hasEnded!: boolean;

  @ApiProperty({
    type: Boolean,
    example: true,
    description: 'Scheduled and not started: it can be moved and re-priced.',
  })
  movable!: boolean;

  @ApiProperty({
    type: Boolean,
    example: true,
    description: 'Scheduled and not ended: it can be cancelled.',
  })
  cancellable!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-10T11:05:00+03:00',
    description: 'When it was scheduled.',
  })
  createdAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-10T11:05:00+03:00',
    description: 'Last change.',
  })
  updatedAt!: string;
}
