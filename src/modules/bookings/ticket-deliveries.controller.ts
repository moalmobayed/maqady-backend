import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, Customer } from '../../common/auth/access.decorators';
import type { CustomerPrincipal } from '../../common/auth/types';
import { Strict } from '../../common/idempotency/idempotency.decorators';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorators';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { BookingResponseMapper } from './booking-response.mapper';
import { BookingRefParams } from './dto/booking-ref.params';
import { TicketDeliveryResponse } from './dto/ticket-delivery.response';
import { SettleFirst } from './settle-first.decorator';
import { TicketDeliveryService } from './ticket-delivery.service';

/** "Email again" (design §11, §13.1; PRD C11, "Email and SMS"). */
@ApiTags('My bookings')
@Controller('bookings')
export class TicketDeliveriesController {
  constructor(
    private readonly deliveries: TicketDeliveryService,
    private readonly mapper: BookingResponseMapper,
  ) {}

  @Post(':ref/ticket-deliveries')
  @Customer()
  @Strict()
  @RateLimit('ticketEmail')
  @SettleFirst('booking')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Email my tickets again',
    description:
      "The signed-in customer who owns the booking, while it is `confirmed` or `completed`. Queues the tickets email (the QR ticket link and the booking page link) to the customer's own account email, the one `GET /me` shows, never by SMS. Requires an `Idempotency-Key`: a new one per press, the same one to retry that press, which replays the first answer (`Idempotent-Replayed: true`) and sends nothing more. Rate-limited to 3 an hour per booking (`RATE_LIMITED` with `Retry-After`); replays and refusals count too. Recorded in the booking's History as \"Tickets resent\".\n\n- A booking without a ticket (held, failed, abandoned, refunded): `TICKET_NOT_AVAILABLE` with `details.status`.\n- Someone else's booking or an unknown reference: `NOT_FOUND`.",
  })
  @ApiCreatedResponse({
    type: TicketDeliveryResponse,
    description: 'The tickets email is queued',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses(
    'VALIDATION_FAILED',
    'NOT_FOUND',
    'TICKET_NOT_AVAILABLE',
    'SERVICE_UNAVAILABLE',
  )
  async emailAgain(
    @CurrentPrincipal() principal: CustomerPrincipal,
    @Param() params: BookingRefParams,
  ): Promise<TicketDeliveryResponse> {
    return this.mapper.ticketDelivery(await this.deliveries.emailAgain(params.ref, principal.id));
  }
}
