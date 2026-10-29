import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, Customer } from '../../common/auth/access.decorators';
import type { CustomerPrincipal } from '../../common/auth/types';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { BookingResponseMapper } from './booking-response.mapper';
import { PRIVATE_CACHE_CONTROL } from './bookings.constants';
import { MyBookingPageResponse } from './dto/my-booking.response';
import { MyBookingsQuery } from './dto/my-bookings.query';
import { MyBookingsService } from './my-bookings.service';
import { SettleFirst } from './settle-first.decorator';

/** My Bookings (design §11; PRD C10). */
@ApiTags('My bookings')
@Controller('me/bookings')
export class MyBookingsController {
  constructor(
    private readonly myBookings: MyBookingsService,
    private readonly mapper: BookingResponseMapper,
  ) {}

  @Get()
  @Customer()
  @SettleFirst('customer')
  @Header('Cache-Control', PRIVATE_CACHE_CONTROL)
  @ApiOperation({
    summary: 'List my bookings (Upcoming or Past)',
    description:
      "The signed-in customer's own bookings, online and at the counter, in two tabs decided now from stored times (never by a background job):\n\n- `upcoming` (default): every `confirmed` booking whose showtime has not ended, soonest show first.\n- `past`: `completed` (the showtime ended), `refunded` (with `refund`) and `failed` (the hold ended after a declined payment), most recent show first.\n\nA booking moves from Upcoming to Past at the showtime's end (`showtime.endsAt`), an instant; each card carries `showtime.cinemaDate`, so a show at 00:30 is labelled with the previous cinema day, as the theater's schedule shows it. Live holds and abandoned holds never appear. A payment whose result is due is settled first, so a slow payment shows as `confirmed` as soon as it went through. `total` counts this tab and `tabCounts` both tabs, for the tab labels. Load more with `cursor` = `nextCursor` and the same `tab`. Personal and time-dependent: `Cache-Control: private, no-store`.",
  })
  @ApiOkResponse({
    type: MyBookingPageResponse,
    description: 'One page of the tab and both tabs’ counts',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'SERVICE_UNAVAILABLE')
  async listMyBookings(
    @CurrentPrincipal() principal: CustomerPrincipal,
    @Query() query: MyBookingsQuery,
  ): Promise<MyBookingPageResponse> {
    return this.mapper.myBookingPage(
      await this.myBookings.list(principal.id, {
        tab: query.tab ?? 'upcoming',
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      }),
    );
  }
}
