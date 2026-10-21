import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/** `/admin/people/{id}`. */
export class PersonIdParams {
  @ApiProperty({ type: 'integer', minimum: 1, example: 4, description: 'Person id.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  id!: number;
}
