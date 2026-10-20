import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength } from 'class-validator';
import { EMAIL_MAX_LENGTH } from '../customers.constants';
import { TrimString } from './transforms';

/** `POST /auth/password-reset-requests` (PRD "Forgot password"). */
export class ForgotPasswordRequest {
  @ApiProperty({
    type: String,
    format: 'email',
    nullable: false,
    maxLength: EMAIL_MAX_LENGTH,
    example: 'layla.hassan@example.com',
    description:
      'The account email. The answer is the same whether or not an account has it, so show "If an account exists for that email, we\'ve sent a link".',
  })
  @TrimString()
  @IsString()
  @MaxLength(EMAIL_MAX_LENGTH)
  @IsEmail({}, { message: 'email must be an email address' })
  email!: string;
}
