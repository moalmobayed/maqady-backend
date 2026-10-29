import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Admin, CurrentPrincipal } from '../../common/auth/access.decorators';
import type { StaffPrincipal } from '../../common/auth/types';
import { Strict } from '../../common/idempotency/idempotency.decorators';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { AdminBookingResponseMapper } from './admin-booking-response.mapper';
import { BookingRefundsService } from './booking-refunds.service';
import { AdminPaymentResponse } from './dto/admin-payment.response';
import { RefundIdParams } from './dto/refund-id.params';

/** Paying out counter refunds (design §7.7; PRD A8 "Mark refund paid out"), admins only. */
@ApiTags('Admin: bookings')
@Controller('admin/refunds')
export class AdminRefundsController {
  constructor(
    private readonly refunds: BookingRefundsService,
    private readonly mapper: AdminBookingResponseMapper,
  ) {}

  @Post(':id/payouts')
  @Admin()
  @Strict()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Record a counter refund as paid out',
    description:
      '"Mark refund paid out" (PRD A8, design §7.7), admins only: the cash or card-terminal refund of a cancellation or an edit was handed back at the counter. Requires an `Idempotency-Key`. The refund becomes `succeeded` with `paidOutAt` and `paidOutBy` (the signed-in admin), and counts in the day\'s Collected from now. Recorded in the activity log.\n\n- An online refund, or one already paid out: `REFUND_NOT_PENDING` with `details.status`.\n- An unknown id, or a charge: `NOT_FOUND`.',
  })
  @ApiCreatedResponse({
    type: AdminPaymentResponse,
    description: 'The refund, paid out',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'REFUND_NOT_PENDING')
  async payOutRefund(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: RefundIdParams,
  ): Promise<AdminPaymentResponse> {
    return this.mapper.payment(await this.refunds.payOut(principal, params.id));
  }
}
