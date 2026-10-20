import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsEmail, IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { STAFF_ROLES } from '../../../common/auth/enums';
import type { StaffRole } from '../../../common/auth/types';
import {
  EMAIL_MAX_LENGTH,
  STAFF_EMAIL_PATTERN,
  STAFF_FULL_NAME_MAX_LENGTH,
} from '../staff.constants';

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** `POST /admin/staff`: the Staff screen's Invite form. */
export class InviteStaffMemberRequest {
  @ApiProperty({
    type: String,
    nullable: false,
    minLength: 1,
    maxLength: STAFF_FULL_NAME_MAX_LENGTH,
    example: 'Mona Adel',
    description: 'Full name, shown in the dashboard and the email. Surrounding spaces are removed.',
  })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'fullName must not be empty' })
  @MaxLength(STAFF_FULL_NAME_MAX_LENGTH)
  fullName!: string;

  @ApiProperty({
    type: String,
    format: 'email',
    nullable: false,
    maxLength: EMAIL_MAX_LENGTH,
    example: 'mona.adel@maqady.example',
    description:
      'Where the invite goes, and the sign-in email afterwards. Unique among staff whatever the letter case (`EMAIL_TAKEN`). Surrounding spaces are removed.',
  })
  @Transform(trim)
  @IsString()
  @MaxLength(EMAIL_MAX_LENGTH)
  @IsEmail({}, { message: 'email must be an email address' })
  @Matches(STAFF_EMAIL_PATTERN, { message: 'email must be an email address' })
  email!: string;

  @ApiProperty({
    enum: STAFF_ROLES,
    enumName: 'StaffRole',
    nullable: false,
    example: 'box_office',
    description:
      '`admin` sees every screen; `box_office` sees Bookings, Customers and Scan tickets. Can be changed later.',
  })
  @IsIn(STAFF_ROLES)
  role!: StaffRole;
}
