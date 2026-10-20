import { ApiProperty } from '@nestjs/swagger';
import { STAFF_ROLES } from '../../../common/auth/enums';
import type { StaffRole } from '../../../common/auth/types';
import type { StaffMember } from '../types';

/** The signed-in staff member, for the dashboard shell (name and role in the footer, the nav). */
export class StaffProfileResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 3, description: 'Staff member id.' })
  id!: number;

  @ApiProperty({ type: String, nullable: false, example: 'Mona Adel', description: 'Full name.' })
  fullName!: string;

  @ApiProperty({
    type: String,
    format: 'email',
    nullable: false,
    example: 'mona.adel@maqady.example',
    description: 'Staff email.',
  })
  email!: string;

  @ApiProperty({
    enum: STAFF_ROLES,
    enumName: 'StaffRole',
    nullable: false,
    example: 'admin',
    description:
      '`admin` sees every screen; `box_office` sees Bookings, Customers and Scan tickets. Read from the database on every request.',
  })
  role!: StaffRole;

  static from(member: StaffMember): StaffProfileResponse {
    return Object.assign(new StaffProfileResponse(), {
      id: member.id,
      fullName: member.fullName,
      email: member.email,
      role: member.role,
    });
  }
}
