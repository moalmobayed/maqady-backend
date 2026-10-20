import { Body, Controller, Delete, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentPrincipal, Public, Staff } from '../../common/auth/access.decorators';
import type { StaffPrincipal } from '../../common/auth/types';
import {
  NoIdempotencyStorage,
  NoRequestTransaction,
} from '../../common/idempotency/idempotency.decorators';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorators';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { RefreshTokensRequest } from '../auth/dto/refresh-tokens.request';
import { SessionTokensResponse } from '../auth/dto/session-tokens.response';
import { StaffSessionResponse, sessionTokensResponseOf } from './dto/staff-session.response';
import { StaffSignInRequest } from './dto/staff-sign-in.request';
import { StaffAuthService } from './staff-auth.service';

@ApiTags('Admin: auth')
@Controller('admin/auth')
export class StaffAuthController {
  constructor(private readonly staffAuth: StaffAuthService) {}

  @Post('sessions')
  @Public()
  @RateLimit('signInEmail', 'signInIp')
  @NoIdempotencyStorage()
  @ApiOperation({
    summary: 'Staff sign-in',
    description:
      'Public: the staff sign-in page (`/admin/login`) calls it with an email and password, and gets a token pair plus who signed in.\n\n- A wrong password, an unknown email and an invited member who has not set a password all answer `INVALID_CREDENTIALS`; the answer never says which.\n- A deactivated member with the right password gets `ACCOUNT_DEACTIVATED`.\n- The access token lasts 15 minutes; the refresh token rotates on every refresh, and the session ends 12 hours after sign-in however often it is refreshed.\n- Limited to 5 attempts per minute per address and email, and 20 per minute per address (`RATE_LIMITED`).\n- Responses carry credentials, so `Idempotency-Key` is ignored; a repeated sign-in opens a second session.',
  })
  @ApiBody({ type: StaffSignInRequest })
  @ApiCreatedResponse({
    type: StaffSessionResponse,
    description: 'Signed in',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'INVALID_CREDENTIALS', 'ACCOUNT_DEACTIVATED')
  async signIn(@Body() body: StaffSignInRequest): Promise<StaffSessionResponse> {
    return StaffSessionResponse.from(await this.staffAuth.signIn(body));
  }

  @Post('tokens')
  @Public()
  @NoRequestTransaction()
  @NoIdempotencyStorage()
  @ApiOperation({
    summary: 'Refresh the staff tokens',
    description:
      'Public: exchange the refresh token for a new pair. Every refresh token works once; store the new pair in place of the old.\n\n- The same token again within 30 seconds of its use answers `REFRESH_CONFLICT` and revokes nothing: another tab or a retry already refreshed, so read the tokens it stored.\n- After 30 seconds, an already-used token is treated as stolen: the whole session is revoked (`SESSION_REVOKED`) and the member must sign in again.\n- `SESSION_EXPIRED` 12 hours after sign-in; `ACCOUNT_DEACTIVATED` once an admin deactivated the member; `UNAUTHENTICATED` for a token nobody issued.\n- Responses carry credentials, so `Idempotency-Key` is ignored.',
  })
  @ApiBody({ type: RefreshTokensRequest })
  @ApiCreatedResponse({
    type: SessionTokensResponse,
    description: 'The new token pair',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'SESSION_EXPIRED',
    'SESSION_REVOKED',
    'ACCOUNT_DEACTIVATED',
    'REFRESH_CONFLICT',
  )
  async refresh(@Body() body: RefreshTokensRequest): Promise<SessionTokensResponse> {
    return sessionTokensResponseOf(await this.staffAuth.refresh(body.refreshToken));
  }

  @Delete('sessions/current')
  @Staff()
  @NoIdempotencyStorage()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Staff sign-out',
    description:
      'Staff (either role): ends the session the access token belongs to. Its access token and every refresh token of the session stop working at once; other sessions of the member (other browsers) stay signed in.',
  })
  @ApiNoContentResponse({ description: 'Signed out', headers: REQUEST_ID_RESPONSE_HEADER })
  async signOut(@CurrentPrincipal() principal: StaffPrincipal): Promise<void> {
    await this.staffAuth.signOut(principal);
  }
}
