import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PageQuery } from '../../../common/pagination/dto/page-query.dto';
import { HALL_STATUSES } from '../enums';
import type { HallStatus } from '../types';

/** `GET /admin/theaters/{id}/halls?status=&cursor=&limit=`. */
export class HallListQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: HALL_STATUSES,
    enumName: 'HallStatus',
    nullable: false,
    example: 'active',
    description: 'Only halls in this status.',
  })
  @IsOptional()
  @IsIn(HALL_STATUSES)
  status?: HallStatus;
}
