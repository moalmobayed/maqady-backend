import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { ONE_TIME_TOKEN_MAX_LENGTH } from '../customers.constants';

/** `POST /auth/email-verifications`: the Verify email page posts the link's token. */
export class EmailVerificationRequest {
  @ApiProperty({
    type: String,
    nullable: false,
    minLength: 1,
    maxLength: ONE_TIME_TOKEN_MAX_LENGTH,
    example: 'Vq3b8kP0xYz1nR5tL9wE2cU7mA4sD6fG8hJ0kL2qW3e',
    description:
      'The `token` query value of the emailed `/verify-email?token=` link, unchanged. A used, expired or mangled one is `INVALID_TOKEN`.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(ONE_TIME_TOKEN_MAX_LENGTH)
  token!: string;
}
