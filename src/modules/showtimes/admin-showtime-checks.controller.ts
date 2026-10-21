import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Admin } from '../../common/auth/access.decorators';
import { NoIdempotencyStorage } from '../../common/idempotency/idempotency.decorators';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { CheckShowtimesRequest } from './dto/check-showtimes.request';
import { ShowtimeCheckResponse } from './dto/showtime-check.response';
import { toShowtimeCheckResponse } from './showtime-response.mapper';
import { ShowtimesService } from './showtimes.service';

@ApiTags('Admin: showtimes')
@Controller('admin/showtime-checks')
export class AdminShowtimeChecksController {
  constructor(private readonly showtimes: ShowtimesService) {}

  @Post()
  @Admin()
  @HttpCode(200)
  @NoIdempotencyStorage()
  @ApiOperation({
    summary: 'Check showtimes before creating them (dry run)',
    description:
      "Admin only: the date chips of the scheduling dialog. Runs every scheduling check for one movie in one hall at one start time on each date, and writes nothing at all (an `Idempotency-Key` is ignored).\n\n- The movie must be Now showing and the hall active (`SHOWTIME_NOT_SCHEDULABLE` with `details.reasons`); prices are not checked here.\n- Each date gets the first check that fails, in this order: `time_does_not_exist` (the start is skipped by the summer-time change that night), `in_past`, `outside_opening_hours` (the showtime must start and end inside that cinema date's opening hours; its 20-minute cleaning may run past closing; a closed date fails), `conflict` (closer than 20 minutes, cleaning included, to another scheduled showtime in the hall, named in `conflicts`); otherwise `available`.\n- `00:00`–`05:59` is after midnight: 16 Oct + `00:30` starts on 17 Oct at 00:30 and belongs to the 16 Oct cinema date.\n- A date that is not available gets up to 3 `suggestions`: free starts on the 5-minute grid that pass every check, nearest to the requested time first.\n- The answer is a forecast: `POST /admin/showtimes` checks again when it writes.",
  })
  @ApiBody({ type: CheckShowtimesRequest })
  @ApiOkResponse({
    type: ShowtimeCheckResponse,
    description: 'Every date, in date order',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'SHOWTIME_NOT_SCHEDULABLE')
  async checkShowtimes(@Body() body: CheckShowtimesRequest): Promise<ShowtimeCheckResponse> {
    return toShowtimeCheckResponse(
      await this.showtimes.check({
        movieId: body.movieId,
        hallId: body.hallId,
        dates: body.dates,
        startTime: body.startTime,
      }),
    );
  }
}
