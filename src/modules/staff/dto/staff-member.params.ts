import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/** `/admin/staff/{id}`. */
export class StaffMemberParams {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 3,
    description: 'Staff member id.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  id!: number;
}
