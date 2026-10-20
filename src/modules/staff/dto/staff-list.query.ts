import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { STAFF_ROLES } from '../../../common/auth/enums';
import type { StaffRole } from '../../../common/auth/types';
import { PageQuery } from '../../../common/pagination/dto/page-query.dto';
import { STAFF_STATUSES } from '../enums';
import type { StaffStatus } from '../types';

/** `GET /admin/staff?role=&status=&cursor=&limit=`. */
export class StaffListQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: STAFF_ROLES,
    enumName: 'StaffRole',
    nullable: false,
    example: 'box_office',
    description: 'Only members of this role.',
  })
  @IsOptional()
  @IsIn(STAFF_ROLES)
  role?: StaffRole;

  @ApiPropertyOptional({
    enum: STAFF_STATUSES,
    enumName: 'StaffStatus',
    nullable: false,
    example: 'active',
    description: 'Only members in this status.',
  })
  @IsOptional()
  @IsIn(STAFF_STATUSES)
  status?: StaffStatus;
}
