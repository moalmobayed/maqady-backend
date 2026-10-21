import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsObject, IsOptional, ValidateNested } from 'class-validator';
import { CheckShowtimesRequest } from './check-showtimes.request';
import { ShowtimePricesRequest } from './showtime-prices.request';

/** `POST /admin/showtimes`: the dry run's request, plus prices and what to do with misfits. */
export class CreateShowtimesRequest extends CheckShowtimesRequest {
  @ApiPropertyOptional({
    type: () => ShowtimePricesRequest,
    nullable: false,
    description:
      "The new showtimes' zone prices. Left out, they copy the theater's default prices (`SHOWTIME_NOT_SCHEDULABLE` `no_prices` when it has none).",
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ShowtimePricesRequest)
  prices?: ShowtimePricesRequest;

  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: true,
    description:
      '`true`: create the dates that fit and skip the others ("Skip unavailable dates"). `false`: create all of them or none.',
  })
  @IsBoolean()
  skipUnavailable!: boolean;
}
