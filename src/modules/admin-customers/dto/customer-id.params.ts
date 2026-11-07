import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/** `/admin/customers/{id}`. */
export class CustomerIdParams {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 42,
    description: 'Customer id.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  id!: number;
}
