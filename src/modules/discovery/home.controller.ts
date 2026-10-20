import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/access.decorators';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { DiscoveryResponseMapper } from './discovery-response.mapper';
import { DISCOVERY_CACHE_CONTROL } from './discovery.constants';
import { HomeResponse } from './dto/home.response';
import { HomeService } from './home.service';

@ApiTags('Discovery')
@Public()
@Controller('home')
export class HomeController {
  constructor(
    private readonly home: HomeService,
    private readonly mapper: DiscoveryResponseMapper,
  ) {}

  @Get()
  @Header('Cache-Control', DISCOVERY_CACHE_CONTROL)
  @ApiOperation({
    summary: 'Everything the home page shows',
    description: [
      'Public; anyone may call it, no token needed. Returns, in one call:',
      '- `featured`: up to 5 movies for the hero carousel, ordered by `position`, each with its hero video and backdrop.',
      '- `ticker`: Now showing movies that still have a bookable showtime today (current cinema day), with that next showtime, soonest first. Movies with nothing left today are left out. Empty until showtimes are scheduled.',
      '- `genres`: every genre, alphabetical, with how many Now showing and Coming soon movies it has. Hide genres with `movieCount: 0` if you like.',
      '- `nowShowing`: up to 12 Now showing movies, newest release first, plus the `total` for "View all".',
      '- `comingSoon`: up to 12 Coming soon movies, soonest release first, plus the `total`.',
      '- `cinemas`: every theater open for sales, alphabetical, with its open state at `serverTime` (judged by the cinema day, 06:00 to 06:00). `mainPhone` is null when the theater hides its contacts.',
      '',
      'Drafts, archived movies and theaters that are drafts or have sales paused never appear. Responses may be cached for 60 seconds (`Cache-Control: public, max-age=60`).',
    ].join('\n'),
  })
  @ApiOkResponse({
    type: HomeResponse,
    description: 'The home page data',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('SERVICE_UNAVAILABLE')
  async getHome(): Promise<HomeResponse> {
    return this.mapper.home(await this.home.getHome());
  }
}
