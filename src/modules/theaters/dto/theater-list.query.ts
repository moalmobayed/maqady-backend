import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PageQuery } from '../../../common/pagination/dto/page-query.dto';
import { THEATER_STATUSES } from '../enums';
import type { TheaterStatus } from '../types';

/** `GET /admin/theaters?status=&cursor=&limit=`. */
export class TheaterListQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: THEATER_STATUSES,
    enumName: 'TheaterStatus',
    nullable: false,
    example: 'active',
    description: 'Only theaters in this status.',
  })
  @IsOptional()
  @IsIn(THEATER_STATUSES)
  status?: TheaterStatus;
}
