import { Body, Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentPrincipal, Guest, Public } from '../../common/auth/access.decorators';
import type { Principal } from '../../common/auth/types';
import { Strict } from '../../common/idempotency/idempotency.decorators';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorators';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { ShowtimeIdParams } from '../showtimes/dto/showtime-id.params';
import { BookingResponseMapper } from './booking-response.mapper';
import { HOLD_MINUTES, MAX_SEATS_PER_HOLD, SEAT_MAP_CACHE_CONTROL } from './bookings.constants';
import { CreateHoldRequest } from './dto/create-hold.request';
import { HoldResponse } from './dto/hold.response';
import { PublicShowtimeResponse } from './dto/public-showtime.response';
import { SeatSnapshotResponse } from './dto/seat-snapshot.response';
import { HoldToken } from './hold-token.decorator';
import { HoldsService } from './holds.service';
import { ShowtimeSeatMapService } from './showtime-seat-map.service';
import { holdTokenHeader } from './swagger-docs';

const VISIBILITY_NOTE =
  'Public. Any showtime of a published theater is shown, in any status, with `bookable` and `notBookableReason`; a showtime of an unpublished (draft) theater, or an unknown id, is `NOT_FOUND`. Never cached (`Cache-Control: no-store`): the map is live.';

/** The seat page (PRD C6) and "Continue", which starts the hold (design §7.3, §11). */
@ApiTags('Seats and holds')
@Controller('showtimes')
export class PublicShowtimesController {
  constructor(
    private readonly seatMap: ShowtimeSeatMapService,
    private readonly holds: HoldsService,
    private readonly mapper: BookingResponseMapper,
  ) {}

  @Get(':id')
  @Public()
  @Header('Cache-Control', SEAT_MAP_CACHE_CONTROL)
  @ApiOperation({
    summary: 'The seat page: showtime header, hall layout and prices',
    description: `${VISIBILITY_NOTE}\n\nThe header (movie with age rating and poster, theater, hall, date and time), this hall's own layout (rows and zones, wheelchair spaces, gaps, aisles), the price of each zone and the "from" price, the seat capacity, and the hold rules (\`maxSeatsPerHold\`, \`holdMinutes\`). The taken seats come from \`GET /showtimes/{id}/seats\` and then live over the \`/ws\` seat map.`,
  })
  @ApiOkResponse({
    type: PublicShowtimeResponse,
    description: 'The showtime and its seat map',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'SERVICE_UNAVAILABLE')
  async getPublicShowtime(@Param() params: ShowtimeIdParams): Promise<PublicShowtimeResponse> {
    return this.mapper.publicShowtime(await this.seatMap.header(params.id));
  }

  @Get(':id/seats')
  @Public()
  @Header('Cache-Control', SEAT_MAP_CACHE_CONTROL)
  @ApiOperation({
    summary: 'The taken seats of a showtime now',
    description: `${VISIBILITY_NOTE}\n\nEvery seat held or sold right now, with \`heldUntil\` for held ones (free the seat on screen when it passes, using \`serverTime\` to correct the clock), and how many seats are left (\`availableCount\`, \`soldOut\`). A hold that ended is free without any message. For live updates subscribe on the \`/ws\` seat map, which starts with this same snapshot.`,
  })
  @ApiOkResponse({
    type: SeatSnapshotResponse,
    description: 'The taken seats',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'SERVICE_UNAVAILABLE')
  async getShowtimeSeats(@Param() params: ShowtimeIdParams): Promise<SeatSnapshotResponse> {
    return this.mapper.seatSnapshot(await this.seatMap.seats(params.id));
  }

  @Post(':id/holds')
  @Guest()
  @Strict()
  @RateLimit('holdIp', 'holdCustomer')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Hold seats for 5 minutes ("Continue")',
    description: `A guest, or a signed-in customer (send the access token). Requires an \`Idempotency-Key\`. Rate-limited per IP address and per customer.\n\n- Holds 1 to ${MAX_SEATS_PER_HOLD} seats for ${HOLD_MINUTES} minutes, or until the showtime starts if sooner. Each seat is priced from its row's zone now; the total is what checkout charges.\n- Picking new seats replaces the browser's previous hold: a customer's live hold (on any showtime), and the guest hold whose code is sent in \`X-Hold-Token\`. Their seats are released at once. A customer has at most one live hold.\n- A guest gets a private \`holdCode\`, shown only in this answer (and its replay). Keep it for the browser session: send it as \`X-Hold-Token\` to read or release the hold, and to claim it after signing in (\`POST /holds/{ref}/claims\`).\n- A seat someone else holds or bought: \`SEAT_TAKEN\` with \`details.seats\`; nothing changes, the previous hold stays. Refresh the map and pick again.\n- \`SHOWTIME_NOT_BOOKABLE\` with \`details.reason\`: \`cancelled\`, \`started\`, \`sales_paused\`, \`movie_unavailable\` or \`hall_unavailable\`. A seat not in this hall: \`VALIDATION_FAILED\` on \`seats.<index>\`. A blocked customer: \`ACCOUNT_BLOCKED\`.\n- Everyone on the seat map gets \`seat.held\` (and \`seat.released\` for a replaced hold) once the hold is saved. Recorded in the booking's history.`,
  })
  @ApiHeader(
    holdTokenHeader(false, 'Optional: the hold this browser made before, released by this one.'),
  )
  @ApiBody({ type: CreateHoldRequest })
  @ApiCreatedResponse({
    type: HoldResponse,
    description: 'The hold, with the hold code for a guest',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses(
    'VALIDATION_FAILED',
    'NOT_FOUND',
    'SHOWTIME_NOT_BOOKABLE',
    'SEAT_TAKEN',
    'ACCOUNT_BLOCKED',
  )
  async createHold(
    @CurrentPrincipal() principal: Principal | undefined,
    @Param() params: ShowtimeIdParams,
    @Body() body: CreateHoldRequest,
    @HoldToken() holdCode: string | undefined,
  ): Promise<HoldResponse> {
    const code = holdCode === undefined ? {} : { holdCode };
    return this.mapper.hold(
      await this.holds.create({
        showtimeId: params.id,
        labels: body.seats,
        holder:
          principal?.kind === 'customer'
            ? { kind: 'customer', customerId: principal.id, ...code }
            : { kind: 'guest', ...code },
      }),
    );
  }
}
