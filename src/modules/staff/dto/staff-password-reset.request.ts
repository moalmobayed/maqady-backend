import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';
import { EMAIL_MAX_LENGTH, STAFF_EMAIL_PATTERN } from '../staff.constants';

/** `POST /admin/auth/password-reset-requests`: the staff "Forgot password" form. */
export class StaffPasswordResetRequest {
  @ApiProperty({
    type: String,
    format: 'email',
    nullable: false,
    maxLength: EMAIL_MAX_LENGTH,
    example: 'mona.adel@maqady.example',
    description: 'The staff email. Letter case and surrounding spaces do not matter.',
  })
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(EMAIL_MAX_LENGTH)
  @IsEmail({}, { message: 'email must be an email address' })
  @Matches(STAFF_EMAIL_PATTERN, { message: 'email must be an email address' })
  email!: string;
}
