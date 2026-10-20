import { ApiProperty } from '@nestjs/swagger';
import { formatCairoIso } from '../../../common/time/time';
import { SessionTokensResponse } from '../../auth/dto/session-tokens.response';
import type { CustomerSession, CustomerTokens } from '../types';
import { CustomerProfileResponse } from './customer-profile.response';

/** A registration or sign-in: the token pair and the signed-in customer. */
export class CustomerSessionResponse extends SessionTokensResponse {
  @ApiProperty({
    type: () => CustomerProfileResponse,
    nullable: false,
    description: 'Who is signed in, as `GET /me` returns it.',
  })
  customer!: CustomerProfileResponse;

  static from(session: CustomerSession): CustomerSessionResponse {
    return Object.assign(new CustomerSessionResponse(), {
      ...tokenFields(session.tokens),
      customer: CustomerProfileResponse.from(session.customer),
    });
  }
}

/** A customer token pair as the refresh route answers it. */
export function customerTokensResponseOf(tokens: CustomerTokens): SessionTokensResponse {
  return Object.assign(new SessionTokensResponse(), tokenFields(tokens));
}

function tokenFields(tokens: CustomerTokens): SessionTokensResponse {
  return {
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: formatCairoIso(tokens.accessTokenExpiresAt),
    refreshToken: tokens.refreshToken,
    refreshTokenExpiresAt: formatCairoIso(tokens.refreshTokenExpiresAt),
  };
}
