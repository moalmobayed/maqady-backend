import { ApiProperty } from '@nestjs/swagger';
import { HEALTH_STATUSES } from '../enums';
import type { HealthStatus } from '../types';

/** `HealthResponse` in the contract agreed with the frontend. */
export class HealthResponse {
  @ApiProperty({
    type: String,
    enum: [...HEALTH_STATUSES],
    nullable: false,
    example: 'ok',
    description: 'Always `ok`. A failed check answers with an error response instead.',
  })
  status!: HealthStatus;
}
