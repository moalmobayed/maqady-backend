import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Admin, CurrentPrincipal } from '../../common/auth/access.decorators';
import type { StaffPrincipal } from '../../common/auth/types';
import { Strict } from '../../common/idempotency/idempotency.decorators';
import { toPageRequest } from '../../common/pagination/cursor';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import type { ZonePrices } from '../theaters/types';
import { AdminShowtimeDetailResponse } from './dto/admin-showtime-detail.response';
import { AdminShowtimeResponse } from './dto/admin-showtime.response';
import { CreateShowtimesRequest } from './dto/create-showtimes.request';
import { ShowtimeBatchResponse } from './dto/showtime-batch.response';
import { ShowtimeIdParams } from './dto/showtime-id.params';
import type { ShowtimePricesRequest } from './dto/showtime-prices.request';
import { ShowtimeTimelineResponse } from './dto/showtime-timeline.response';
import { TimelineQuery } from './dto/timeline.query';
import { UpdateShowtimeRequest } from './dto/update-showtime.request';
import {
  toAdminShowtimeDetailResponse,
  toAdminShowtimeResponse,
  toShowtimeBatchResponse,
  toShowtimeTimelineResponse,
} from './showtime-response.mapper';
import { ShowtimesService } from './showtimes.service';

@ApiTags('Admin: showtimes')
@Controller('admin/showtimes')
export class AdminShowtimesController {
  constructor(private readonly showtimes: ShowtimesService) {}

  @Get()
  @Admin()
  @ApiOperation({
    summary: "A theater's showtime timeline for one cinema date",
    description:
      "Admin only: the Showtimes page (PRD A5). For one theater and cinema date (06:00 to 06:00 Cairo time): the date's opening hours (`window`, null when closed), the hall rows (every active hall, plus any other hall with a showtime that date, by name), and a page of the showtimes by start, scheduled and cancelled, with `hallId` and `status` filters. Cursor-paged.",
  })
  @ApiOkResponse({
    type: ShowtimeTimelineResponse,
    description: 'The timeline and one page of showtimes',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async listShowtimes(@Query() query: TimelineQuery): Promise<ShowtimeTimelineResponse> {
    return toShowtimeTimelineResponse(
      await this.showtimes.timeline(
        {
          theaterId: query.theaterId,
          cinemaDate: query.date,
          ...(query.hallId !== undefined ? { hallId: query.hallId } : {}),
          ...(query.status !== undefined ? { status: query.status } : {}),
        },
        toPageRequest(query, 'instant'),
      ),
    );
  }

  @Post()
  @Admin()
  @Strict()
  @ApiOperation({
    summary: 'Schedule a movie on one or more dates',
    description:
      "Admin only: \"Create\" in the scheduling dialog. Schedules one Now showing movie in one active hall at one start time on 1 to 31 cinema dates, each date in its own savepoint, with the same checks as `POST /admin/showtime-checks` (the database itself refuses two showtimes in a hall less than 20 minutes apart, cleaning included). Requires an `Idempotency-Key`.\n\n- Prices: `prices`, or else the theater's default prices (`SHOWTIME_NOT_SCHEDULABLE` `no_prices` when it has none). Seat capacity: the hall's seat count.\n- `skipUnavailable: true` creates the dates that fit and reports the others; `false` creates all of them or none.\n- When nothing is created (or one date fails with `skipUnavailable: false`) the answer is `SHOWTIMES_NOT_CREATED` with every date's result, nothing is written, and the key is not used up: retry after fixing.\n- Each new showtime is recorded in the activity log.",
  })
  @ApiBody({ type: CreateShowtimesRequest })
  @ApiCreatedResponse({
    type: ShowtimeBatchResponse,
    description: 'Every date, in date order, with the showtimes created',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses(
    'VALIDATION_FAILED',
    'NOT_FOUND',
    'SHOWTIME_NOT_SCHEDULABLE',
    'SHOWTIMES_NOT_CREATED',
  )
  async createShowtimes(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Body() body: CreateShowtimesRequest,
  ): Promise<ShowtimeBatchResponse> {
    return toShowtimeBatchResponse(
      await this.showtimes.createBatch(principal, {
        movieId: body.movieId,
        hallId: body.hallId,
        dates: body.dates,
        startTime: body.startTime,
        skipUnavailable: body.skipUnavailable,
        ...(body.prices ? { prices: pricesOf(body.prices) } : {}),
      }),
    );
  }

  @Get(':id')
  @Admin()
  @ApiOperation({
    summary: 'Get a showtime',
    description:
      'Admin only: the manage panel. The showtime in any status, with its movie, theater, hall, times, prices, seat capacity and what can still be done with it (`movable`, `cancellable`).',
  })
  @ApiOkResponse({
    type: AdminShowtimeDetailResponse,
    description: 'The showtime',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async getShowtime(@Param() params: ShowtimeIdParams): Promise<AdminShowtimeDetailResponse> {
    return toAdminShowtimeDetailResponse(await this.showtimes.get(params.id));
  }

  @Patch(':id')
  @Admin()
  @Strict()
  @ApiOperation({
    summary: 'Move, re-price or cancel a showtime',
    description:
      "Admin only: the manage panel's actions, one per request. Requires an `Idempotency-Key`.\n\n- **Move**: `startTime` (and `cinemaDate` for another date), in the same hall, before the showtime starts. Every check runs again with the movie's current runtime: Now showing movie and active hall (`SHOWTIME_NOT_SCHEDULABLE`), a start that exists that night (`TIME_DOES_NOT_EXIST`) and is in the future (`VALIDATION_FAILED`), inside the opening hours (`OUTSIDE_OPENING_HOURS` with `details.window`), 20 minutes from every other showtime in the hall (`SHOWTIME_CONFLICT` naming them). Every ticket holder is sent the new time by email, and by SMS when they gave a phone.\n- **Prices**: `prices`, before the showtime starts; for new holds only.\n- **Cancel**: `status: cancelled` with `cancelReason`, alone, until the showtime ends. Confirmed bookings are refunded and their holders told. Final; the slot is free again.\n- A started showtime is not moved or re-priced, an ended one is not cancelled, a cancelled one is not changed (`SHOWTIME_NOT_EDITABLE` with `details.reason`).\n- A request that changes nothing answers `200` and records nothing; anything else is recorded in the activity log.",
  })
  @ApiBody({ type: UpdateShowtimeRequest })
  @ApiOkResponse({
    type: AdminShowtimeResponse,
    description: 'The showtime after the change',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses(
    'VALIDATION_FAILED',
    'NOT_FOUND',
    'SHOWTIME_NOT_SCHEDULABLE',
    'SHOWTIME_NOT_EDITABLE',
    'SHOWTIME_CONFLICT',
    'OUTSIDE_OPENING_HOURS',
    'TIME_DOES_NOT_EXIST',
  )
  async updateShowtime(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: ShowtimeIdParams,
    @Body() body: UpdateShowtimeRequest,
  ): Promise<AdminShowtimeResponse> {
    return toAdminShowtimeResponse(
      await this.showtimes.update(principal, params.id, {
        ...(body.cinemaDate !== undefined ? { cinemaDate: body.cinemaDate } : {}),
        ...(body.startTime !== undefined ? { startTime: body.startTime } : {}),
        ...(body.prices ? { prices: pricesOf(body.prices) } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.cancelReason !== undefined ? { cancelReason: body.cancelReason } : {}),
      }),
    );
  }
}

function pricesOf(body: ShowtimePricesRequest): ZonePrices {
  return {
    front: { amount: body.front.amount, currency: body.front.currency },
    middle: { amount: body.middle.amount, currency: body.middle.currency },
    back: { amount: body.back.amount, currency: body.back.currency },
  };
}
