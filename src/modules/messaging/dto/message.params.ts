import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/** `/admin/messages/{id}`. */
export class MessageParams {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 42,
    description: 'Message id, from the list.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  id!: number;
}
