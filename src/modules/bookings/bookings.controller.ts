import { Controller, Get, Param } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, Guest } from '../../common/auth/access.decorators';
import type { Principal } from '../../common/auth/types';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { BookingReadService } from './booking-read.service';
import { BookingResponseMapper } from './booking-response.mapper';
import { BookingRefParams } from './dto/booking-ref.params';
import { BookingResponse } from './dto/booking.response';
import { HoldToken } from './hold-token.decorator';
import { SettleFirst } from './settle-first.decorator';
import { holdTokenHeader } from './swagger-docs';

/** A booking as its holder reads it (design §10.4, §11). */
@ApiTags('Seats and holds')
@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookings: BookingReadService,
    private readonly mapper: BookingResponseMapper,
  ) {}

  @Get(':ref')
  @Guest()
  @SettleFirst('booking')
  @ApiOperation({
    summary: 'Get a booking',
    description:
      'The owner (send the access token) in any status, or a guest with the hold code in `X-Hold-Token` while the hold lasts and nobody claimed it. Anyone else, a guest whose hold ended, and any unknown reference: `NOT_FOUND`. The checkout summary: the showtime, the seats by zone with their prices, the total, the countdown (`holdExpiresAt` against `serverTime`) and the status, decided now. A payment still processing is settled first when its result is due, so polling this route after `payment.settlesAt` shows the result (`confirmed` with its `ticket`, or `held` with `paymentStatus: declined`); with `paymentStatus: processing`, poll again in a few seconds. The confirmation page and the booking page read it too: `payment` ("EGP 380 · Visa •••• 4242"), `ticket` with its QR payload, `confirmedAt`.',
  })
  @ApiHeader(holdTokenHeader(false, 'Required for a guest hold.'))
  @ApiOkResponse({
    type: BookingResponse,
    description: 'The booking',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async getBooking(
    @CurrentPrincipal() principal: Principal | undefined,
    @Param() params: BookingRefParams,
    @HoldToken() holdCode: string | undefined,
  ): Promise<BookingResponse> {
    return this.mapper.booking(
      await this.bookings.get(params.ref, {
        ...(principal?.kind === 'customer' ? { customerId: principal.id } : {}),
        ...(holdCode === undefined ? {} : { holdCode }),
      }),
    );
  }
}
