import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsObject,
  ValidateBy,
  ValidateIf,
  ValidateNested,
  type ValidationArguments,
} from 'class-validator';
import { CANCEL_REASONS } from '../enums';
import type { CancelReason } from '../types';
import { ShowtimePricesRequest } from './showtime-prices.request';
import { IsCinemaDate, IsStartTime } from './showtime.validators';

const NOTHING_TO_CHANGE =
  'send startTime (with cinemaDate to move to another date), prices, or status with cancelReason';
const CANCEL_ALONE = 'a cancellation is sent alone: status and cancelReason, nothing else';

const sent = (_: object, value: unknown): boolean => value !== undefined;

function cancelling(body: UpdateShowtimeRequest): boolean {
  return body.status !== undefined || body.cancelReason !== undefined;
}

function editing(body: UpdateShowtimeRequest): boolean {
  return body.cinemaDate !== undefined || body.startTime !== undefined || body.prices !== undefined;
}

/**
 * `PATCH /admin/showtimes/{id}`, one manage-panel action per request:
 *
 * - move: `startTime`, with `cinemaDate` to move to another date;
 * - new prices: `prices`;
 * - both of those at once;
 * - cancel: `status: cancelled` with `cancelReason`, and nothing else.
 */
export class UpdateShowtimeRequest {
  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-17',
    description:
      'Move: the new cinema date, `YYYY-MM-DD`. Needs `startTime`; left out, the date stays.',
  })
  @ValidateIf(sent)
  @IsCinemaDate()
  cinemaDate?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: false,
    pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
    example: '21:00',
    description:
      "Move: the new Cairo wall-clock start, `HH:mm` (`00:00`–`05:59` is after midnight, still the same cinema date). Every scheduling check runs again with the movie's current runtime.",
  })
  // Required with `cinemaDate`, and named when nothing at all is sent.
  @ValidateIf(
    (body: UpdateShowtimeRequest) =>
      body.startTime !== undefined ||
      body.cinemaDate !== undefined ||
      (!cancelling(body) && body.prices === undefined),
  )
  @IsDefined({ message: NOTHING_TO_CHANGE })
  @IsStartTime()
  startTime?: string;

  @ApiPropertyOptional({
    type: () => ShowtimePricesRequest,
    nullable: false,
    description:
      'New zone prices. They apply to new holds only; seats already held or sold keep theirs.',
  })
  @ValidateIf(sent)
  @IsObject()
  @ValidateNested()
  @Type(() => ShowtimePricesRequest)
  prices?: ShowtimePricesRequest;

  @ApiPropertyOptional({
    enum: ['cancelled'],
    nullable: false,
    example: 'cancelled',
    description: 'Cancel: always with `cancelReason`, and alone. Final.',
  })
  @ValidateIf((body: UpdateShowtimeRequest) => cancelling(body))
  @IsDefined({ message: 'status must be cancelled when cancelReason is sent' })
  @IsIn(['cancelled'])
  @ValidateBy({
    name: 'cancelAlone',
    validator: {
      validate: (_value: unknown, args?: ValidationArguments) =>
        !editing(args?.object as UpdateShowtimeRequest),
      defaultMessage: () => CANCEL_ALONE,
    },
  })
  status?: 'cancelled';

  @ApiPropertyOptional({
    enum: CANCEL_REASONS,
    enumName: 'ShowtimeCancelReason',
    nullable: false,
    example: 'technical_issue',
    description: 'Cancel: why. Required with `status: cancelled`.',
  })
  @ValidateIf((body: UpdateShowtimeRequest) => cancelling(body))
  @IsDefined({ message: 'cancelReason is required to cancel' })
  @IsIn(CANCEL_REASONS)
  cancelReason?: CancelReason;
}
