import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/** `/admin/showtimes/{id}`. */
export class ShowtimeIdParams {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 81,
    description: 'Showtime id.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  id!: number;
}
