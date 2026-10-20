import { Body, Controller, Delete, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
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
import { StaffPasswordResetRequest } from './dto/staff-password-reset.request';
import { StaffPasswordSetupRequest } from './dto/staff-password-setup.request';
import { StaffSessionResponse, sessionTokensResponseOf } from './dto/staff-session.response';
import { StaffSignInRequest } from './dto/staff-sign-in.request';
import { StaffAuthService } from './staff-auth.service';
import { StaffOnboardingService } from './staff-onboarding.service';

@ApiTags('Admin: auth')
@Controller('admin/auth')
export class StaffAuthController {
  constructor(
    private readonly staffAuth: StaffAuthService,
    private readonly onboarding: StaffOnboardingService,
  ) {}

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

  @Post('password-reset-requests')
  @Public()
  @RateLimit('emailRequestEmail', 'emailRequestIp')
  @NoIdempotencyStorage()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Staff "Forgot password"',
    description:
      'Public: the "Forgot password" link of the staff sign-in page. Always answers `202` with no body, whether or not the email belongs to a staff member, so show "If a staff account exists for that email, we\'ve sent a link" either way.\n\n- Only an active member gets an email: a link to `/admin/set-password` that works once, for 1 hour. Asking again voids the previous link.\n- An invited member gets nothing (an admin resends their invite), nor does a deactivated one.\n- Limited to 3 requests per hour per email and 20 per hour per address, shared with the customer "Forgot password" and resend-verification routes (`RATE_LIMITED`).\n- `Idempotency-Key` is ignored.',
  })
  @ApiBody({ type: StaffPasswordResetRequest })
  @ApiAcceptedResponse({
    description: 'Accepted; an email is sent if an active staff member has this address',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED')
  async requestPasswordReset(@Body() body: StaffPasswordResetRequest): Promise<void> {
    await this.onboarding.requestPasswordReset(body.email);
  }

  @Post('password-setups')
  @Public()
  @RateLimit('signInIp')
  @NoIdempotencyStorage()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Set a staff password from an emailed link',
    description:
      'Public: the Set your password page (`/admin/set-password?token=…`) sends the link\'s token with the new password. Invite and reset links both work here.\n\n- An invite link makes the invited member `active` with this password; a reset link replaces an active member\'s password and signs them out everywhere.\n- No session is opened: send the member to `/admin/login` to sign in with the new password.\n- Each link works once. An unknown, used, expired or replaced link is `INVALID_TOKEN`: offer "Forgot password", or ask an admin to resend the invite.\n- A password that breaks the rule (8 to 128 characters including a digit) is `VALIDATION_FAILED`, and the link still works. A deactivated member is `ACCOUNT_DEACTIVATED`.\n- Limited to 20 per minute per address, shared with staff sign-in (`RATE_LIMITED`). `Idempotency-Key` is ignored.',
  })
  @ApiBody({ type: StaffPasswordSetupRequest })
  @ApiNoContentResponse({ description: 'The password is set', headers: REQUEST_ID_RESPONSE_HEADER })
  @ApiErrorResponses('VALIDATION_FAILED', 'INVALID_TOKEN', 'ACCOUNT_DEACTIVATED')
  async setUpPassword(@Body() body: StaffPasswordSetupRequest): Promise<void> {
    await this.onboarding.setPassword({ token: body.token, password: body.password });
  }
}
