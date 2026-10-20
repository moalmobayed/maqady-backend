import { ApiProperty } from '@nestjs/swagger';
import { STAFF_ROLES } from '../../../common/auth/enums';
import type { StaffRole } from '../../../common/auth/types';
import { formatCairoIso } from '../../../common/time/time';
import { STAFF_STATUSES } from '../enums';
import type { StaffMember, StaffStatus } from '../types';

/** One row of the Staff screen (PRD "Staff"). */
export class StaffMemberResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 3, description: 'Staff member id.' })
  id!: number;

  @ApiProperty({ type: String, nullable: false, example: 'Mona Adel', description: 'Full name.' })
  fullName!: string;

  @ApiProperty({
    type: String,
    format: 'email',
    nullable: false,
    example: 'mona.adel@maqady.example',
    description: 'Staff email; unique among staff.',
  })
  email!: string;

  @ApiProperty({
    enum: STAFF_ROLES,
    enumName: 'StaffRole',
    nullable: false,
    example: 'box_office',
    description: '`admin` or `box_office`.',
  })
  role!: StaffRole;

  @ApiProperty({
    enum: STAFF_STATUSES,
    enumName: 'StaffStatus',
    nullable: false,
    example: 'active',
    description:
      '`invited`: has not set a password yet. `active`: may sign in. `deactivated`: switched off by an admin; can be reactivated.',
  })
  status!: StaffStatus;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-20T09:12:00+03:00',
    description: 'The last successful sign-in; null if the member never signed in.',
  })
  lastSignInAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-01T10:00:00+03:00',
    description: 'When the member was created (invited, or created by the setup command).',
  })
  createdAt!: string;

  static from(member: StaffMember): StaffMemberResponse {
    return Object.assign(new StaffMemberResponse(), {
      id: member.id,
      fullName: member.fullName,
      email: member.email,
      role: member.role,
      status: member.status,
      lastSignInAt: member.lastSignInAt ? formatCairoIso(member.lastSignInAt) : null,
      createdAt: formatCairoIso(member.createdAt),
    });
  }
}
