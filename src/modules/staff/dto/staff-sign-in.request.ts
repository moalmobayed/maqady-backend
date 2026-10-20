import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { EMAIL_MAX_LENGTH, SIGN_IN_PASSWORD_MAX_LENGTH } from '../staff.constants';

/** `POST /admin/auth/sessions`. */
export class StaffSignInRequest {
  @ApiProperty({
    type: String,
    format: 'email',
    nullable: false,
    maxLength: EMAIL_MAX_LENGTH,
    example: 'mona.adel@maqady.example',
    description: 'The staff email. Letter case does not matter.',
  })
  @IsString()
  @MaxLength(EMAIL_MAX_LENGTH)
  @IsEmail({}, { message: 'email must be an email address' })
  email!: string;

  @ApiProperty({
    type: String,
    format: 'password',
    nullable: false,
    minLength: 1,
    maxLength: SIGN_IN_PASSWORD_MAX_LENGTH,
    example: 'Cinema2026',
    description: 'The password as typed. The password policy is not checked here.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(SIGN_IN_PASSWORD_MAX_LENGTH)
  password!: string;
}
