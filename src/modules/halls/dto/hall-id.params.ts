import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/** `/admin/halls/{id}`. */
export class HallIdParams {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 3,
    description: 'Hall id.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  id!: number;
}
