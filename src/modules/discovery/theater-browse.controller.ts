import { Controller, Get, Param, Query, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/access.decorators';
import { toPageRequest } from '../../common/pagination/cursor';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { TheaterIdParams } from '../theaters/dto/theater-id.params';
import { DiscoveryCacheInterceptor } from './discovery-cache.interceptor';
import { DiscoveryResponseMapper } from './discovery-response.mapper';
import { PUBLIC_READ_NOTE } from './discovery.constants';
import { PublicTheaterListQuery } from './dto/discovery.queries';
import { PublicTheaterPageResponse, PublicTheaterResponse } from './dto/public-theater.response';
import { TheaterBrowseService } from './theater-browse.service';

/** The public theater reads (PRD C4, C5): the Theaters page and a theater's page. */
@ApiTags('Discovery')
@Public()
@UseInterceptors(DiscoveryCacheInterceptor)
@Controller('theaters')
export class TheaterBrowseController {
  constructor(
    private readonly theaters: TheaterBrowseService,
    private readonly mapper: DiscoveryResponseMapper,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'The Theaters page: cards and map',
    description: `${PUBLIC_READ_NOTE}\n\nEvery theater open for sales, alphabetical, with its open state (judged by the cinema day, so 01:30 on Thursday uses Wednesday's hours), today's and the weekly hours, its location and its facilities. \`openNow=true\` keeps the theaters open now; \`parking=true\` those with free or valet parking. \`mainPhone\` is null when the theater hides its contacts. Cursor-paginated (default 20, at most 100).`,
  })
  @ApiOkResponse({
    type: PublicTheaterPageResponse,
    description: 'One page of theaters',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'SERVICE_UNAVAILABLE')
  async listPublicTheaters(
    @Query() query: PublicTheaterListQuery,
  ): Promise<PublicTheaterPageResponse> {
    const page = await this.theaters.list(
      {
        ...(query.openNow === undefined ? {} : { openNow: query.openNow }),
        ...(query.parking === undefined ? {} : { parking: query.parking }),
      },
      toPageRequest(query, 'text'),
    );
    return this.mapper.theaterPage(page);
  }

  @Get(':id')
  @ApiOperation({
    summary: "A theater's page",
    description: `${PUBLIC_READ_NOTE}\n\nThe theater's details, gallery, open state, weekly hours and the special dates of the next 7 cinema days. Phones and email appear only when the theater shows its contacts (\`phones\` is empty and \`email\` null otherwise). A draft, a paused or an unknown theater is \`404 NOT_FOUND\`. Halls and showtimes come with them.`,
  })
  @ApiOkResponse({
    type: PublicTheaterResponse,
    description: 'The theater',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'SERVICE_UNAVAILABLE')
  async getPublicTheater(@Param() params: TheaterIdParams): Promise<PublicTheaterResponse> {
    return this.mapper.theater(await this.theaters.find(params.id));
  }
}
