import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../auth/auth.constants';
import { IsAllowedPassword } from '../../auth/password-policy';
import { SET_PASSWORD_TOKEN_MAX_LENGTH } from '../staff.constants';

/** `POST /admin/auth/password-setups`: the Set your password page (`/admin/set-password`). */
export class StaffPasswordSetupRequest {
  @ApiProperty({
    type: String,
    nullable: false,
    minLength: 1,
    maxLength: SET_PASSWORD_TOKEN_MAX_LENGTH,
    example: 'q3VbI2vT0xSx5n2b7i1d9mJ8kQe4zW6yR0tP5uL3aGc',
    description:
      'The `token` query parameter of the emailed link (`/admin/set-password?token=…`), unchanged. Invite and reset links both work here. A token that is unknown, used or expired is `INVALID_TOKEN`, never `VALIDATION_FAILED`.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(SET_PASSWORD_TOKEN_MAX_LENGTH)
  token!: string;

  @ApiProperty({
    type: String,
    format: 'password',
    nullable: false,
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    example: 'Cinema2026',
    description: `The new password: ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters including a digit. A password that breaks the rule is \`VALIDATION_FAILED\` and leaves the link usable.`,
  })
  @IsString()
  @IsAllowedPassword()
  password!: string;
}
