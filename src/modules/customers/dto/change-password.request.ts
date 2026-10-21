import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { IsAllowedPassword } from '../../auth/password-policy';
import { SIGN_IN_PASSWORD_MAX_LENGTH } from '../customers.constants';

/** `PUT /me/password` (PRD C12 Change password). The "confirm" field stays in the frontend. */
export class ChangePasswordRequest {
  @ApiProperty({
    type: String,
    format: 'password',
    nullable: false,
    minLength: 1,
    maxLength: SIGN_IN_PASSWORD_MAX_LENGTH,
    example: 'Cinema2026',
    description:
      'The password in use now. A wrong one is `VALIDATION_FAILED` with this field named in `details.fields`.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(SIGN_IN_PASSWORD_MAX_LENGTH)
  currentPassword!: string;

  @ApiProperty({
    type: String,
    format: 'password',
    nullable: false,
    minLength: 8,
    maxLength: 128,
    example: 'NewCinema2026',
    description: 'The new password: at least 8 characters including a digit.',
  })
  @IsAllowedPassword()
  newPassword!: string;
}
