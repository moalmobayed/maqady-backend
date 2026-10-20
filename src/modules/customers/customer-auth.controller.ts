import { Body, Controller, Delete, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentPrincipal, Customer, Public } from '../../common/auth/access.decorators';
import type { CustomerPrincipal } from '../../common/auth/types';
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
import { CustomerAuthService } from './customer-auth.service';
import { CustomerSessionResponse, customerTokensResponseOf } from './dto/customer-session.response';
import { CustomerSignInRequest } from './dto/customer-sign-in.request';
import { EmailVerificationRequest } from './dto/email-verification.request';
import { ForgotPasswordRequest } from './dto/forgot-password.request';
import { RegisterCustomerRequest } from './dto/register-customer.request';
import { ResetPasswordRequest } from './dto/reset-password.request';

const CREDENTIALS_NOT_STORED =
  'Responses carry credentials, so `Idempotency-Key` is ignored and nothing is stored.';

@ApiTags('Auth')
@Controller('auth')
export class CustomerAuthController {
  constructor(private readonly customerAuth: CustomerAuthService) {}

  @Post('registrations')
  @Public()
  @RateLimit('registrationIp')
  @NoIdempotencyStorage()
  @ApiOperation({
    summary: 'Create a customer account',
    description: `Public: the Create account form (\`/register\`, standalone or in the booking flow). Creates the account, emails a verification link and signs the customer in, so the booking flow can claim its hold next.\n\n- An email that already has an account, in any letter case, is \`EMAIL_TAKEN\`.\n- The verification link opens \`/verify-email?token=\` and works for 24 hours. Verification blocks nothing.\n- The access token lasts 15 minutes; the session ends 30 days after sign-in however often it is refreshed.\n- Limited to 5 registrations per hour per address (\`RATE_LIMITED\`).\n- ${CREDENTIALS_NOT_STORED} A repeated registration answers \`EMAIL_TAKEN\`.`,
  })
  @ApiBody({ type: RegisterCustomerRequest })
  @ApiCreatedResponse({
    type: CustomerSessionResponse,
    description: 'Account created and signed in',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'EMAIL_TAKEN')
  async registerCustomer(@Body() body: RegisterCustomerRequest): Promise<CustomerSessionResponse> {
    return CustomerSessionResponse.from(await this.customerAuth.register(body));
  }

  @Post('sessions')
  @Public()
  @RateLimit('signInEmail', 'signInIp')
  @NoIdempotencyStorage()
  @ApiOperation({
    summary: 'Customer sign-in',
    description: `Public: the Sign in form (\`/login\`, standalone or in the booking flow). Returns a token pair and the customer.\n\n- A wrong password and an unknown email both answer \`INVALID_CREDENTIALS\`; the answer never says which.\n- A blocked customer with the right password gets \`ACCOUNT_BLOCKED\`: show the "Account blocked" screen.\n- The access token lasts 15 minutes; the refresh token rotates on every refresh, and the session ends 30 days after sign-in.\n- Limited to 5 attempts per minute per address and email, and 20 per minute per address (\`RATE_LIMITED\`, "too many attempts").\n- ${CREDENTIALS_NOT_STORED} A repeated sign-in opens a second session.`,
  })
  @ApiBody({ type: CustomerSignInRequest })
  @ApiCreatedResponse({
    type: CustomerSessionResponse,
    description: 'Signed in',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'INVALID_CREDENTIALS', 'ACCOUNT_BLOCKED')
  async signInCustomer(@Body() body: CustomerSignInRequest): Promise<CustomerSessionResponse> {
    return CustomerSessionResponse.from(await this.customerAuth.signIn(body));
  }

  @Post('tokens')
  @Public()
  @NoRequestTransaction()
  @NoIdempotencyStorage()
  @ApiOperation({
    summary: 'Refresh the customer tokens',
    description: `Public: exchange the refresh token for a new pair. Every refresh token works once; store the new pair in place of the old.\n\n- The same token again within 30 seconds of its use answers \`REFRESH_CONFLICT\` and revokes nothing: another tab or a retry already refreshed, so read the tokens it stored.\n- After 30 seconds, an already-used token is treated as stolen: the whole session is revoked (\`SESSION_REVOKED\`) and the customer signs in again.\n- \`SESSION_EXPIRED\` 30 days after sign-in; \`UNAUTHENTICATED\` for a token nobody issued, including a staff refresh token.\n- Blocking a customer ends all their sessions, so their refresh answers \`SESSION_REVOKED\`, not \`ACCOUNT_BLOCKED\`: send them to sign in, where the right password answers \`ACCOUNT_BLOCKED\`. Their access token, while it lasts, answers \`ACCOUNT_BLOCKED\` on every customer route.\n- ${CREDENTIALS_NOT_STORED}`,
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
    'ACCOUNT_BLOCKED',
    'REFRESH_CONFLICT',
  )
  async refreshCustomerTokens(@Body() body: RefreshTokensRequest): Promise<SessionTokensResponse> {
    return customerTokensResponseOf(await this.customerAuth.refresh(body.refreshToken));
  }

  @Delete('sessions/current')
  @Customer()
  @NoIdempotencyStorage()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Customer sign-out',
    description:
      'Customer: the Profile\'s "Sign out". Ends the session the access token belongs to: its access token and every refresh token of the session stop working at once. Other devices stay signed in.',
  })
  @ApiNoContentResponse({ description: 'Signed out', headers: REQUEST_ID_RESPONSE_HEADER })
  async signOutCustomer(@CurrentPrincipal() principal: CustomerPrincipal): Promise<void> {
    await this.customerAuth.signOut(principal);
  }

  @Post('email-verifications')
  @Public()
  @RateLimit('signInIp')
  @NoIdempotencyStorage()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Verify the email with an emailed link',
    description:
      'Public: the Verify email page (`/verify-email?token=`) posts the link\'s `token` here; no sign-in needed.\n\n- Success marks the email verified; the Profile then shows "Verified".\n- A used, expired (after 24 hours), superseded (a newer link was sent) or mangled link is `INVALID_TOKEN`: show "expired link" with a resend button (`POST /auth/email-verification-requests`, signed in).\n- Limited with sign-in, 20 per minute per address (`RATE_LIMITED`).',
  })
  @ApiBody({ type: EmailVerificationRequest })
  @ApiNoContentResponse({ description: 'Email verified', headers: REQUEST_ID_RESPONSE_HEADER })
  @ApiErrorResponses('VALIDATION_FAILED', 'INVALID_TOKEN')
  async verifyCustomerEmail(@Body() body: EmailVerificationRequest): Promise<void> {
    await this.customerAuth.verifyEmail(body.token);
  }

  @Post('email-verification-requests')
  @Customer()
  @RateLimit('verificationResendCustomer', 'emailRequestIp')
  @NoIdempotencyStorage()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Send the verification link again',
    description:
      'Customer: the "resend the link" action on the Profile and the Verify email page. Sends a new 24-hour link to the account email; the previous link stops working. A customer already verified is sent nothing, with the same answer.\n\n- Limited to 3 per hour per customer, and 20 per hour per address (`RATE_LIMITED`).',
  })
  @ApiAcceptedResponse({
    description: 'Accepted; no body',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  async resendCustomerEmailVerification(
    @CurrentPrincipal() principal: CustomerPrincipal,
  ): Promise<void> {
    await this.customerAuth.resendVerification(principal);
  }

  @Post('password-reset-requests')
  @Public()
  @RateLimit('emailRequestEmail', 'emailRequestIp')
  @NoIdempotencyStorage()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Forgot password: email a reset link',
    description:
      'Public: the Forgot password page (`/forgot-password`). When an active account has this email, a reset link is sent: it opens `/reset-password?token=` and works once, for 1 hour; an earlier link stops working.\n\n- Always `202` with no body, whether or not the email has an account (or is blocked), so show "If an account exists for that email, we\'ve sent a link".\n- Limited to 3 per hour per email, shared with the staff forgot-password route, and 20 per hour per address (`RATE_LIMITED`).',
  })
  @ApiBody({ type: ForgotPasswordRequest })
  @ApiAcceptedResponse({
    description: 'Accepted; no body, whether or not the email has an account',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED')
  async requestCustomerPasswordReset(@Body() body: ForgotPasswordRequest): Promise<void> {
    await this.customerAuth.requestPasswordReset(body.email);
  }

  @Post('password-resets')
  @Public()
  @RateLimit('signInIp')
  @NoIdempotencyStorage()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Set a new password with an emailed link',
    description:
      "Public: the Set a new password page (`/reset-password?token=`) posts the link's `token` and the new password.\n\n- Success sets the password, marks the email verified (the link proved the mailbox) and signs the customer out everywhere. It opens no session: send them to sign in with the new password.\n- A used, expired (after 1 hour), superseded or mangled link is `INVALID_TOKEN`: explain and offer a new link.\n- A password that breaks the rules (8 characters including a digit) is `VALIDATION_FAILED`, and the link still works.\n- `ACCOUNT_BLOCKED` when the account was blocked; the link is not used up.\n- Limited with sign-in, 20 per minute per address (`RATE_LIMITED`).",
  })
  @ApiBody({ type: ResetPasswordRequest })
  @ApiNoContentResponse({ description: 'Password changed', headers: REQUEST_ID_RESPONSE_HEADER })
  @ApiErrorResponses('VALIDATION_FAILED', 'INVALID_TOKEN', 'ACCOUNT_BLOCKED')
  async resetCustomerPassword(@Body() body: ResetPasswordRequest): Promise<void> {
    await this.customerAuth.resetPassword(body);
  }
}
