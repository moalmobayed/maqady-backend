import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { IsAllowedPassword } from '../../auth/password-policy';
import { ONE_TIME_TOKEN_MAX_LENGTH } from '../customers.constants';

/** `POST /auth/password-resets`: the Set a new password page posts the link's token. */
export class ResetPasswordRequest {
  @ApiProperty({
    type: String,
    nullable: false,
    minLength: 1,
    maxLength: ONE_TIME_TOKEN_MAX_LENGTH,
    example: 'Vq3b8kP0xYz1nR5tL9wE2cU7mA4sD6fG8hJ0kL2qW3e',
    description:
      'The `token` query value of the emailed `/reset-password?token=` link, unchanged. A used, expired or mangled one is `INVALID_TOKEN`: offer a new link.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(ONE_TIME_TOKEN_MAX_LENGTH)
  token!: string;

  @ApiProperty({
    type: String,
    format: 'password',
    nullable: false,
    minLength: 8,
    maxLength: 128,
    example: 'NewCinema2026',
    description:
      'The new password: at least 8 characters including a digit. A weak one is refused before the link is used, so the link still works.',
  })
  @IsAllowedPassword()
  password!: string;
}
