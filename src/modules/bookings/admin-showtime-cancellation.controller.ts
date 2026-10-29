import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Admin } from '../../common/auth/access.decorators';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { ShowtimeIdParams } from '../showtimes/dto/showtime-id.params';
import { AdminBookingResponseMapper } from './admin-booking-response.mapper';
import { BookingsShowtimeCancellation } from './bookings-showtime-cancellation.service';
import { ShowtimeCancellationPreviewResponse } from './dto/showtime-cancellation-preview.response';
import { SettleFirst } from './settle-first.decorator';

/** The impact of cancelling a showtime (design §7.7; PRD A5), read from bookings and payments. */
@ApiTags('Admin: showtimes')
@Controller('admin/showtimes')
export class AdminShowtimeCancellationController {
  constructor(
    private readonly cancellation: BookingsShowtimeCancellation,
    private readonly mapper: AdminBookingResponseMapper,
  ) {}

  @Get(':id/cancellation-preview')
  @Admin()
  @SettleFirst('showtime')
  @ApiOperation({
    summary: 'Preview cancelling a showtime',
    description:
      'Admins only: "Cancel this showtime" shows its impact (PRD A5) before `PATCH /admin/showtimes/{id}` with `status: cancelled`: the confirmed bookings and seats refunded, the total refunded online (cards and wallets, through the provider), the total owed back at the counter (cash and card terminal, each charge\'s remaining amount), the seat holds released, and the emails and SMS sent ("Everyone is emailed and sent an SMS"). `cancellable` says whether the showtime can still be cancelled (scheduled and not ended). Due slow payments of the showtime are settled first. An unknown showtime: `NOT_FOUND`.',
  })
  @ApiOkResponse({
    type: ShowtimeCancellationPreviewResponse,
    description: 'What cancelling would do now',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'SERVICE_UNAVAILABLE')
  async previewShowtimeCancellation(
    @Param() params: ShowtimeIdParams,
  ): Promise<ShowtimeCancellationPreviewResponse> {
    return this.mapper.cancellationPreview(await this.cancellation.preview(params.id));
  }
}
