import { Controller, Delete, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Customer, CurrentPrincipal, Guest } from '../../common/auth/access.decorators';
import type { CustomerPrincipal, Principal } from '../../common/auth/types';
import { AppError } from '../../common/errors/app-error';
import { Strict } from '../../common/idempotency/idempotency.decorators';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { BookingResponseMapper } from './booking-response.mapper';
import { BookingRefParams } from './dto/booking-ref.params';
import { HoldResponse } from './dto/hold.response';
import { HoldToken } from './hold-token.decorator';
import { HoldsService } from './holds.service';
import { holdTokenHeader } from './swagger-docs';

/** Claiming a guest hold at sign-in, and releasing a hold (design §7.3, §11). */
@ApiTags('Seats and holds')
@Controller('holds')
export class HoldsController {
  constructor(
    private readonly holds: HoldsService,
    private readonly mapper: BookingResponseMapper,
  ) {}

  @Post(':ref/claims')
  @Customer()
  @Strict()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Claim a guest hold after signing in',
    description:
      "A signed-in customer, with the guest hold's code in `X-Hold-Token` (required). Requires an `Idempotency-Key`. Call it right after signing in or creating an account in the booking flow (PRD Seats 3).\n\n- The hold becomes the customer's, with their name, email and phone as its contact, and the code stops working. The countdown is not restarted: `holdExpiresAt` stays.\n- The customer's other live hold, if any, is released (one live hold per customer), and its seats are announced free on the seat map.\n- A hold the customer already owns answers `201` as it is (a second tab).\n- An unknown reference, someone else's booking, or a code that does not match: `NOT_FOUND`. The code matches but the hold ran out: `HOLD_EXPIRED` (pick seats again). No `X-Hold-Token`: `VALIDATION_FAILED`.\n- Recorded in the booking's history.",
  })
  @ApiHeader(holdTokenHeader(true, 'Required: it proves this browser made the hold.'))
  @ApiCreatedResponse({
    type: HoldResponse,
    description: "The hold, now the customer's (`holdCode` is null)",
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'HOLD_EXPIRED')
  async claimHold(
    @CurrentPrincipal() principal: CustomerPrincipal,
    @Param() params: BookingRefParams,
    @HoldToken() holdCode: string | undefined,
  ): Promise<HoldResponse> {
    if (holdCode === undefined) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fields: [
          { field: 'X-Hold-Token', messages: ['X-Hold-Token is required: the guest hold code.'] },
        ],
      });
    }
    const booking = await this.holds.claim(principal, params.ref, holdCode);
    return this.mapper.hold({ booking, holdCode: null });
  }

  @Delete(':ref')
  @Guest()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Release a hold',
    description:
      "The owner (send the access token), or a guest with the hold code in `X-Hold-Token`. An `Idempotency-Key` is optional. The seats are free at once (announced on the seat map) and the booking reads as `abandoned` from then on. A hold that already ended answers `204` and changes nothing. A paid booking is never released here: `ALREADY_PAID`. Anyone else, and any unknown reference: `NOT_FOUND`. Recorded in the booking's history.",
  })
  @ApiHeader(holdTokenHeader(false, 'Required for a guest hold.'))
  @ApiNoContentResponse({ description: 'Released', headers: REQUEST_ID_RESPONSE_HEADER })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'ALREADY_PAID')
  async releaseHold(
    @CurrentPrincipal() principal: Principal | undefined,
    @Param() params: BookingRefParams,
    @HoldToken() holdCode: string | undefined,
  ): Promise<void> {
    await this.holds.release(
      {
        ...(principal?.kind === 'customer' ? { customerId: principal.id } : {}),
        ...(holdCode === undefined ? {} : { holdCode }),
      },
      params.ref,
    );
  }
}
