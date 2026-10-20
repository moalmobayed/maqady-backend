import { ApiProperty } from '@nestjs/swagger';
import { formatCairoIso } from '../../../common/time/time';
import { SessionTokensResponse } from '../../auth/dto/session-tokens.response';
import type { StaffSignInResult, StaffTokens } from '../types';
import { StaffProfileResponse } from './staff-profile.response';

/** A staff sign-in: the token pair and who signed in. */
export class StaffSessionResponse extends SessionTokensResponse {
  @ApiProperty({
    type: () => StaffProfileResponse,
    nullable: false,
    description: 'Who signed in, for the dashboard shell.',
  })
  staff!: StaffProfileResponse;

  static from(result: StaffSignInResult): StaffSessionResponse {
    return Object.assign(new StaffSessionResponse(), {
      ...tokenFields(result.tokens),
      staff: StaffProfileResponse.from(result.member),
    });
  }
}

/** A staff token pair as the refresh route answers it. */
export function sessionTokensResponseOf(tokens: StaffTokens): SessionTokensResponse {
  return Object.assign(new SessionTokensResponse(), tokenFields(tokens));
}

function tokenFields(tokens: StaffTokens): SessionTokensResponse {
  return {
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: formatCairoIso(tokens.accessTokenExpiresAt),
    refreshToken: tokens.refreshToken,
    refreshTokenExpiresAt: formatCairoIso(tokens.refreshTokenExpiresAt),
  };
}
