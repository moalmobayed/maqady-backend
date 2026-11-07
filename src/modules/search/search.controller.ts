import { Controller, Get, Query, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/access.decorators';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorators';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { DiscoveryCacheInterceptor } from '../discovery/discovery-cache.interceptor';
import { SearchQuery } from './dto/search.query';
import { SearchResultsResponse } from './dto/search.response';
import { SearchResponseMapper } from './search-response.mapper';
import { SearchService } from './search.service';

/** The customer site's search results page (PRD "Search results" `/search?q=`). */
@ApiTags('Search')
@Controller('search')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly mapper: SearchResponseMapper,
  ) {}

  @Get()
  @Public()
  @RateLimit('search')
  @UseInterceptors(DiscoveryCacheInterceptor)
  @ApiOperation({
    summary: 'Search movies, people and theaters',
    description:
      'Public; no token needed. The nav search\'s results page, grouped, up to 5 of each, best match first:\n\n- `movies`: Coming soon and Now showing movies whose title or a credited person\'s name matches; a cast match names the person in `matchedPerson`.\n- `people`: people credited on a Coming soon or Now showing movie whose name matches (open the Movies page with `/movies?people=<id>`).\n- `theaters`: theaters open for sales (`active`) whose name or district matches.\n\nDrafts, archived movies and theaters that are drafts or have paused sales never appear. Matching is case-insensitive and accepts part of a word; from 3 characters a name or title with a typo matches too ("Incepton" finds "Inception"). Ranking: the whole value, then a value starting with the query, then one containing it, then a typo-tolerant match, the closest first. Each group says whether more matched (`hasMore`); empty groups are the empty state. Limited to 60 searches a minute per IP address (`429 RATE_LIMITED` with `Retry-After`). May be cached for 60 seconds (`Cache-Control: public, max-age=60`; an error `no-store`).',
  })
  @ApiOkResponse({
    type: SearchResultsResponse,
    description: 'The results, grouped',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'SERVICE_UNAVAILABLE')
  async searchPublic(@Query() query: SearchQuery): Promise<SearchResultsResponse> {
    return this.mapper.publicResults(await this.search.searchPublic(query.q));
  }
}
