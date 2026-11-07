import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/** `/admin/refunds/{id}`: a refund's id, as `AdminPayment.id` shows it. */
export class RefundIdParams {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 418,
    description: 'The refund (`AdminPayment.id` of a `kind: refund` row).',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  id!: number;
}
