import { Controller, Get, Param, Query, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/access.decorators';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { MovieIdParams } from '../catalog/dto/movie-id.params';
import { TheaterIdParams } from '../theaters/dto/theater-id.params';
import { DiscoveryCacheInterceptor } from './discovery-cache.interceptor';
import { DiscoveryResponseMapper } from './discovery-response.mapper';
import { PUBLIC_READ_NOTE } from './discovery.constants';
import { TheaterShowtimesQuery } from './dto/discovery.queries';
import { MovieShowtimesResponse } from './dto/movie-showtimes.response';
import { TheaterShowtimesResponse } from './dto/theater-showtimes.response';
import { ShowtimeBrowseService } from './showtime-browse.service';

/** What every public showtime list shows, and what it leaves out. */
const SHOWTIME_LIST_NOTE =
  'Only scheduled showtimes of theaters open for sales and of Now showing movies; cancelled ones never appear. Days are cinema days (06:00 to 06:00): a showtime starting at 00:30 is listed under the day before, with its real `startsAt`. A showtime that has ended is left out; one that has started is listed with `hasStarted: true` and can no longer be booked. Each chip has the zone `prices` and the `fromPrice`, the cheapest zone the hall has seats in.';

/** The public showtime lists (PRD C3, C5): a movie's and a theater's next 7 cinema days. */
@ApiTags('Discovery')
@Public()
@UseInterceptors(DiscoveryCacheInterceptor)
@Controller()
export class ShowtimeBrowseController {
  constructor(
    private readonly showtimes: ShowtimeBrowseService,
    private readonly mapper: DiscoveryResponseMapper,
  ) {}

  @Get('movies/:id/showtimes')
  @ApiOperation({
    summary: "A movie's showtimes over 7 cinema days",
    description: `${PUBLIC_READ_NOTE}\n\n${SHOWTIME_LIST_NOTE}\n\nAlways 7 \`days\`, today's cinema date first, each with its theaters alphabetical and their showtimes by start time; \`theaters\` is the theater picker with each theater's count over the 7 days. A Coming soon movie has no showtimes (7 empty days). A draft, an archived or an unknown movie is \`404 NOT_FOUND\`.`,
  })
  @ApiOkResponse({
    type: MovieShowtimesResponse,
    description: "The movie's 7 cinema days",
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'SERVICE_UNAVAILABLE')
  async listMovieShowtimes(@Param() params: MovieIdParams): Promise<MovieShowtimesResponse> {
    return this.mapper.movieShowtimes(await this.showtimes.movieShowtimes(params.id));
  }

  @Get('theaters/:id/showtimes')
  @ApiOperation({
    summary: "A theater's showtimes over 7 cinema days, or one",
    description: `${PUBLIC_READ_NOTE}\n\n${SHOWTIME_LIST_NOTE}\n\nThe 7 cinema days from today's, or only \`date\`; each day lists its movies (as cards) by their first showtime, each with its time chips. A \`date\` outside those 7 days answers that day with no movies; a malformed one is \`400 VALIDATION_FAILED\`. A draft, a paused or an unknown theater is \`404 NOT_FOUND\`.`,
  })
  @ApiOkResponse({
    type: TheaterShowtimesResponse,
    description: "The theater's cinema days",
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'SERVICE_UNAVAILABLE')
  async listTheaterShowtimes(
    @Param() params: TheaterIdParams,
    @Query() query: TheaterShowtimesQuery,
  ): Promise<TheaterShowtimesResponse> {
    return this.mapper.theaterShowtimes(
      await this.showtimes.theaterShowtimes(params.id, query.date),
    );
  }
}
