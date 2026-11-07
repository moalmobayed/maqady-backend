import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotContains,
} from 'class-validator';
import { PageQuery } from '../../../common/pagination/dto/page-query.dto';
import { PAYMENT_METHODS } from '../../payments/enums';
import type { PaymentMethod } from '../../payments/types';
import { IsCinemaDate } from '../../showtimes/dto/showtime.validators';
import { SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH } from '../bookings.constants';
import { BOOKING_CHANNELS, BOOKING_DISPLAY_STATUSES } from '../enums';
import type { BookingChannel, BookingDisplayStatus } from '../types';

/**
 * `GET /admin/bookings?q=&theaterId=&movieId=&status=&channel=&method=&dateFrom=&dateTo=&customerId=&cursor=&limit=`
 * (PRD A6 search and filters). Every filter is optional and they combine (AND).
 */
export class AdminBookingsQuery extends PageQuery {
  @ApiPropertyOptional({
    type: String,
    nullable: false,
    minLength: SEARCH_MIN_LENGTH,
    maxLength: SEARCH_MAX_LENGTH,
    example: 'MQ-7K3P9Q',
    description: `Search, ${SEARCH_MIN_LENGTH} to ${SEARCH_MAX_LENGTH} characters (surrounding spaces dropped): a booking reference (any case) finds that booking; anything else is matched, case-insensitively, anywhere in the booking's contact name, email or phone ("Booking no., name, email, phone"). An Egyptian mobile typed locally (\`01012345678\`) also finds its stored \`+201012345678\`.`,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(SEARCH_MIN_LENGTH)
  @MaxLength(SEARCH_MAX_LENGTH)
  @NotContains('\u0000', { message: 'q must not contain a NUL character' })
  q?: string;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 1,
    description: 'Only bookings of showtimes at this theater.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  theaterId?: number;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 12,
    description: 'Only bookings of showtimes of this movie.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  movieId?: number;

  @ApiPropertyOptional({
    enum: BOOKING_DISPLAY_STATUSES,
    enumName: 'BookingStatus',
    nullable: false,
    example: 'confirmed',
    description:
      'Only bookings in this status now (decided from stored times, like `status` on each booking): `held`, `failed`, `abandoned`, `confirmed`, `completed` or `refunded`.',
  })
  @IsOptional()
  @IsIn(BOOKING_DISPLAY_STATUSES)
  status?: BookingDisplayStatus;

  @ApiPropertyOptional({
    enum: BOOKING_CHANNELS,
    enumName: 'BookingChannel',
    nullable: false,
    example: 'counter',
    description: '`online` (the website) or `counter` (the box office).',
  })
  @IsOptional()
  @IsIn(BOOKING_CHANNELS)
  channel?: BookingChannel;

  @ApiPropertyOptional({
    enum: PAYMENT_METHODS,
    enumName: 'PaymentMethod',
    nullable: false,
    example: 'card',
    description:
      'Only bookings with a sale payment attempt of this method: `card`, `wallet`, `cash` or `card_terminal`.',
  })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  method?: PaymentMethod;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description:
      'Bookings made on or after this cinema date (`YYYY-MM-DD`; a cinema day runs from 06:00 to 06:00 Cairo time). With `dateTo` for a range; both the same date for one day (the Today card).',
  })
  @IsOptional()
  @IsCinemaDate()
  dateFrom?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description:
      'Bookings made on or before this cinema date (inclusive: until 06:00 the next morning). Not before `dateFrom`.',
  })
  @IsOptional()
  @IsCinemaDate()
  dateTo?: string;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 42,
    description:
      "Only this customer's bookings, whatever the channel (the Customers drawer's bookings, `GET /admin/customers/{id}`). An unknown or anonymised customer simply has none.",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  customerId?: number;
}
