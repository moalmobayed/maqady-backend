import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, Customer } from '../../common/auth/access.decorators';
import type { CustomerPrincipal } from '../../common/auth/types';
import { PageQuery } from '../../common/pagination/dto/page-query.dto';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { BookingHistoryService } from './booking-history.service';
import { BookingResponseMapper } from './booking-response.mapper';
import { PRIVATE_CACHE_CONTROL } from './bookings.constants';
import { BookingHistoryEventPageResponse } from './dto/booking-history-event.response';
import { BookingRefParams } from './dto/booking-ref.params';
import { SettleFirst } from './settle-first.decorator';

/** A booking's History (design §11, §13.5; PRD C11 "History from real events"). */
@ApiTags('My bookings')
@Controller('bookings')
export class BookingHistoryController {
  constructor(
    private readonly history: BookingHistoryService,
    private readonly mapper: BookingResponseMapper,
  ) {}

  @Get(':ref/history')
  @Customer()
  @SettleFirst('booking')
  @Header('Cache-Control', PRIVATE_CACHE_CONTROL)
  @ApiOperation({
    summary: "Get a booking's History",
    description:
      'The signed-in customer who owns the booking; anyone else\'s booking, or an unknown reference, is `NOT_FOUND`. The booking page\'s History, oldest first, from the real recorded events: `seats_held` ("Seats held"), `payment_received` ("Payment received"), `refunded` ("Refunded"), `changed_by_cinema` ("Changed by the cinema": the showtime was moved, or the booking edited, while it held a ticket) and `tickets_resent` ("Tickets resent", by "Email again" or by the cinema). Declined payments, sign-in claims and check-ins are not shown, nor who acted. Cursor-paginated like every list. `Cache-Control: private, no-store`.',
  })
  @ApiOkResponse({
    type: BookingHistoryEventPageResponse,
    description: "One page of the booking's History",
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'SERVICE_UNAVAILABLE')
  async getHistory(
    @CurrentPrincipal() principal: CustomerPrincipal,
    @Param() params: BookingRefParams,
    @Query() query: PageQuery,
  ): Promise<BookingHistoryEventPageResponse> {
    return this.mapper.historyPage(
      await this.history.list(params.ref, principal.id, {
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      }),
    );
  }
}
