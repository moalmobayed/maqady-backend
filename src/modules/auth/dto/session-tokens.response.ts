import { ApiProperty } from '@nestjs/swagger';

/** A new token pair, from a sign-in or a refresh (design §10.2). */
export class SessionTokensResponse {
  @ApiProperty({
    type: String,
    nullable: false,
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl',
    description:
      'Send as `Authorization: Bearer <accessToken>`. Valid 15 minutes; keep it in memory only.',
  })
  accessToken!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-20T19:45:00+03:00',
    description: 'When the access token stops working. Refresh shortly before.',
  })
  accessTokenExpiresAt!: string;

  @ApiProperty({
    type: String,
    nullable: false,
    example: 'q3VbI2vT0xSx5n2b7i1d9mJ8kQe4zW6yR0tP5uL3aGc',
    description:
      'Opaque, single use. Exchange it at the refresh route for a new pair, and store the new one in place of this one.',
  })
  refreshToken!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-21T07:30:00+03:00',
    description:
      'When the session ends: 12 hours after sign-in for staff, 30 days for customers. Refreshing never extends it; sign in again after.',
  })
  refreshTokenExpiresAt!: string;
}
