import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDefined, IsIn, ValidateIf } from 'class-validator';
import { STAFF_ROLES } from '../../../common/auth/enums';
import type { StaffRole } from '../../../common/auth/types';
import { SETTABLE_STAFF_STATUSES } from '../enums';
import type { SettableStaffStatus } from '../types';

const NOTHING_TO_CHANGE = 'send role, status or both';

/** `PATCH /admin/staff/{id}`: change a member's role, status or both. */
export class UpdateStaffMemberRequest {
  @ApiPropertyOptional({
    enum: STAFF_ROLES,
    enumName: 'StaffRole',
    nullable: false,
    example: 'box_office',
    description:
      'The new role. Demoting an admin signs them out everywhere; they sign in again as box office. Refused with `LAST_ADMIN` for the only active admin.',
  })
  // Validated when sent, and when `status` is missing too, so an empty body names a field.
  @ValidateIf(
    (body: UpdateStaffMemberRequest) => body.role !== undefined || body.status === undefined,
  )
  @IsDefined({ message: NOTHING_TO_CHANGE })
  @IsIn(STAFF_ROLES)
  role?: StaffRole;

  @ApiPropertyOptional({
    enum: SETTABLE_STAFF_STATUSES,
    nullable: false,
    example: 'deactivated',
    description:
      '`deactivated` signs the member out everywhere and voids their unused invite or reset links; refused with `LAST_ADMIN` for the only active admin. `active` reactivates a deactivated member; one who never set a password returns to `invited` instead, so the invite can be resent. `active` on an invited member is `VALIDATION_FAILED`: they become active by setting their password.',
  })
  @ValidateIf((body: UpdateStaffMemberRequest) => body.status !== undefined)
  @IsIn(SETTABLE_STAFF_STATUSES)
  status?: SettableStaffStatus;
}
