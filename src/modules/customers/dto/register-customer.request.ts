import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { IsAllowedPassword } from '../../auth/password-policy';
import { CUSTOMER_FULL_NAME_MAX_LENGTH, EMAIL_MAX_LENGTH } from '../customers.constants';
import { TrimString } from './transforms';

/** `POST /auth/registrations` (PRD C7 Create account). */
export class RegisterCustomerRequest {
  @ApiProperty({
    type: String,
    nullable: false,
    minLength: 1,
    maxLength: CUSTOMER_FULL_NAME_MAX_LENGTH,
    example: 'Layla Hassan',
    description: 'Full name, as shown on the Profile. Surrounding spaces are dropped.',
  })
  @TrimString()
  @IsString()
  @MinLength(1, { message: 'fullName must not be empty' })
  @MaxLength(CUSTOMER_FULL_NAME_MAX_LENGTH)
  fullName!: string;

  @ApiProperty({
    type: String,
    format: 'email',
    nullable: false,
    maxLength: EMAIL_MAX_LENGTH,
    example: 'layla.hassan@example.com',
    description:
      'The sign-in email; a verification link is sent to it. Letter case does not matter, and an email already registered is `EMAIL_TAKEN`. It cannot be changed later.',
  })
  @TrimString()
  @IsString()
  @MaxLength(EMAIL_MAX_LENGTH)
  @IsEmail({}, { message: 'email must be an email address' })
  email!: string;

  @ApiProperty({
    type: String,
    format: 'password',
    nullable: false,
    minLength: 8,
    maxLength: 128,
    example: 'Cinema2026',
    description: 'At least 8 characters including a digit, at most 128.',
  })
  @IsAllowedPassword()
  password!: string;
}
