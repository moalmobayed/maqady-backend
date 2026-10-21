import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, Customer } from '../../common/auth/access.decorators';
import type { CustomerPrincipal } from '../../common/auth/types';
import { Strict } from '../../common/idempotency/idempotency.decorators';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorators';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { BookingResponseMapper } from './booking-response.mapper';
import { CheckoutService } from './checkout.service';
import { BookingRefParams } from './dto/booking-ref.params';
import { CreatePaymentRequest } from './dto/create-payment.request';
import { PaymentResultResponse } from './dto/payment-result.response';
import { SettleFirst } from './settle-first.decorator';

/** Paying for a hold online (design §7.5, §11; PRD C8 Checkout, Payments 1–4). */
@ApiTags('Checkout')
@Controller('bookings')
export class BookingPaymentsController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly mapper: BookingResponseMapper,
  ) {}

  @Post(':ref/payments')
  @Customer()
  @Strict()
  @RateLimit('payment')
  @SettleFirst('booking')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Pay for a hold (card or wallet, simulated)',
    description:
      'The signed-in customer who owns the hold (a guest claims it first, `POST /holds/{ref}/claims`). Requires an `Idempotency-Key`: a new one per press of Pay, the same one to retry that press. Rate-limited per booking (10 in 5 minutes). Paying does not need a verified email (PRD Accounts 2).\n\n- The total is the hold\'s own (`total`); there are no fees. The provider is simulated: the test `token` decides the result, and no card number is ever sent.\n- `201` with `payment.status` `succeeded`: the booking is `confirmed`, its seats are sold (announced as `seat.booked` on the seat map), and the tickets email (and SMS with a phone on file) is on its way. `booking.ticket` holds the QR payload.\n- `201` with `declined`: a normal result, not an error. The seats stay held until the timer ends; try again or switch method with a new `Idempotency-Key`. `cancelled` (a wallet closed) is not a decline.\n- `201` with `processing`: show "Confirming your payment". The seats stay held until `payment.settlesAt` plus 30 seconds, even past the timer (PRD Seats 5); read `GET /bookings/{ref}` after `settlesAt` for the result. Paying again meanwhile is `PAYMENT_IN_PROGRESS`.\n- Pressing Pay twice never charges twice: the same key replays the first answer (`Idempotent-Replayed: true`); another key finds the booking paid (`ALREADY_PAID`) or still processing.\n- `HOLD_EXPIRED`: the hold ended (at `holdExpiresAt` exactly, too) or lost a seat; nothing was charged ("Your seats were released. Pick seats again."). `SHOWTIME_NOT_BOOKABLE` with `details.reason`: the showtime started or was cancelled, the theater paused sales, the movie or hall is no longer available. Someone else\'s booking, a guest\'s hold, or an unknown reference: `NOT_FOUND`. A blocked customer: `ACCOUNT_BLOCKED`.\n- Recorded in the booking\'s history.',
  })
  @ApiBody({ type: CreatePaymentRequest })
  @ApiCreatedResponse({
    type: PaymentResultResponse,
    description: 'The payment result and the booking after it',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses(
    'VALIDATION_FAILED',
    'NOT_FOUND',
    'SHOWTIME_NOT_BOOKABLE',
    'HOLD_EXPIRED',
    'ALREADY_PAID',
    'PAYMENT_IN_PROGRESS',
    'SERVICE_UNAVAILABLE',
  )
  async createPayment(
    @CurrentPrincipal() principal: CustomerPrincipal,
    @Param() params: BookingRefParams,
    @Body() body: CreatePaymentRequest,
  ): Promise<PaymentResultResponse> {
    return this.mapper.paymentResult(
      await this.checkout.pay({
        reference: params.ref,
        customerId: principal.id,
        method: body.method,
        token: body.token,
      }),
    );
  }
}
