import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Put } from '@nestjs/common';
import {
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentPrincipal, Customer } from '../../common/auth/access.decorators';
import type { CustomerPrincipal } from '../../common/auth/types';
import { NoIdempotencyStorage } from '../../common/idempotency/idempotency.decorators';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorators';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { CustomerProfileService } from './customer-profile.service';
import { ChangePasswordRequest } from './dto/change-password.request';
import { CustomerProfileResponse } from './dto/customer-profile.response';
import { UpdateProfileRequest } from './dto/update-profile.request';

@ApiTags('Profile')
@Controller('me')
export class MeController {
  constructor(private readonly profiles: CustomerProfileService) {}

  @Get()
  @Customer()
  @ApiOperation({
    summary: 'The signed-in customer',
    description:
      'Customer: the Profile page and the site header. Name, email with its verification state, phone and "Member since".',
  })
  @ApiOkResponse({
    type: CustomerProfileResponse,
    description: 'The signed-in customer',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  async getCustomerProfile(
    @CurrentPrincipal() principal: CustomerPrincipal,
  ): Promise<CustomerProfileResponse> {
    return CustomerProfileResponse.from(await this.profiles.get(principal));
  }

  @Patch()
  @Customer()
  @ApiOperation({
    summary: 'Edit the signed-in customer’s details',
    description:
      'Customer: "Your details" on the Profile. Send `fullName`, `phone` or both; fields not sent stay as they are. The email is read-only, and any other field is `VALIDATION_FAILED`.\n\n- `phone` takes an international number (`+201012345678`) or an Egyptian mobile as typed (`01012345678`, stored as `+201012345678`); `null` removes it.\n- Returns the profile as it now is.',
  })
  @ApiBody({ type: UpdateProfileRequest })
  @ApiOkResponse({
    type: CustomerProfileResponse,
    description: 'The updated profile',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED')
  async updateCustomerProfile(
    @CurrentPrincipal() principal: CustomerPrincipal,
    @Body() body: UpdateProfileRequest,
  ): Promise<CustomerProfileResponse> {
    return CustomerProfileResponse.from(
      await this.profiles.update(principal, {
        ...(body.fullName === undefined ? {} : { fullName: body.fullName }),
        ...(body.phone === undefined ? {} : { phone: body.phone }),
      }),
    );
  }

  @Put('password')
  @Customer()
  @RateLimit('signInIp')
  @NoIdempotencyStorage()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Change the password',
    description:
      'Customer: "Change password" on the Profile (the "confirm" field is checked by the page).\n\n- A wrong `currentPassword` is `VALIDATION_FAILED` with `currentPassword` named in `details.fields`, not a 401: the customer stays signed in.\n- The new password needs at least 8 characters including a digit.\n- Success signs out every other device; this one stays signed in with its current tokens.\n- Limited with sign-in, 20 per minute per address (`RATE_LIMITED`).\n- Password routes never store responses, so `Idempotency-Key` is ignored.',
  })
  @ApiBody({ type: ChangePasswordRequest })
  @ApiNoContentResponse({ description: 'Password changed', headers: REQUEST_ID_RESPONSE_HEADER })
  @ApiErrorResponses('VALIDATION_FAILED')
  async changeCustomerPassword(
    @CurrentPrincipal() principal: CustomerPrincipal,
    @Body() body: ChangePasswordRequest,
  ): Promise<void> {
    await this.profiles.changePassword(principal, body);
  }
}
