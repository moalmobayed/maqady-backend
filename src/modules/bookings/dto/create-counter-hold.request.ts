import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { CreateHoldRequest } from './create-hold.request';

/**
 * `POST /admin/counter-holds`: the showtime and the seats a box office member picked on the live
 * map (PRD A6 "New booking"). The seats follow the online hold's rules (1 to 8, PRD call 4).
 */
export class CreateCounterHoldRequest extends CreateHoldRequest {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 81,
    description:
      'The showtime to sell. It must be bookable now, exactly as online: scheduled and not started, its movie Now showing, its theater selling (Active) and its hall active (`SHOWTIME_NOT_BOOKABLE` with `details.reason` otherwise); a showtime of a draft theater, or an unknown id, is `NOT_FOUND`.',
  })
  @IsInt({ message: 'showtimeId must be a positive integer' })
  @Min(1, { message: 'showtimeId must be a positive integer' })
  @Max(Number.MAX_SAFE_INTEGER, { message: 'showtimeId must be a positive integer' })
  showtimeId!: number;
}
