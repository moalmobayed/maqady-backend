import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { OPAQUE_TOKEN_PATTERN } from '../auth.constants';

/** `POST /admin/auth/tokens` (and U9's `POST /auth/tokens`): exchange a refresh token. */
export class RefreshTokensRequest {
  @ApiProperty({
    type: String,
    nullable: false,
    pattern: OPAQUE_TOKEN_PATTERN.source,
    minLength: 43,
    maxLength: 43,
    example: 'q3VbI2vT0xSx5n2b7i1d9mJ8kQe4zW6yR0tP5uL3aGc',
    description:
      'The refresh token from the last sign-in or refresh. Each one works once: replace both stored tokens with the pair this call returns.',
  })
  @IsString()
  @Matches(OPAQUE_TOKEN_PATTERN, { message: 'refreshToken must be a refresh token as issued' })
  refreshToken!: string;
}
