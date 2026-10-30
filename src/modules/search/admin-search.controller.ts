import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, Staff } from '../../common/auth/access.decorators';
import type { StaffPrincipal } from '../../common/auth/types';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { AdminSearchResultsResponse } from './dto/admin-search.response';
import { SearchQuery } from './dto/search.query';
import { STAFF_SEARCH_CACHE_CONTROL } from './search.constants';
import { SearchResponseMapper } from './search-response.mapper';
import { SearchService } from './search.service';

/** The dashboard top bar's search results page (PRD "Admin search results", both roles). */
@ApiTags('Admin: search')
@Controller('admin/search')
export class AdminSearchController {
  constructor(
    private readonly search: SearchService,
    private readonly mapper: SearchResponseMapper,
  ) {}

  @Get()
  @Staff()
  @Header('Cache-Control', STAFF_SEARCH_CACHE_CONTROL)
  @ApiOperation({
    summary: 'Search the dashboard',
    description:
      "Staff (box office or admin). The top bar search's results page, grouped, up to 10 of each, best match first, limited to what the role may see:\n\n- `bookings` (both roles): a whole booking reference in any case (`mq-7k3p9q`) finds exactly that booking; anything else matches the contact name (part of it, or with a typo from 3 characters), email or phone (part of it; a local mobile `01012345678` also finds `+201012345678`). Any status, rows as the Bookings table shows them; due slow payments are settled first.\n- `customers` (both roles): live accounts by name, email or phone, the same way. A deleted (anonymised) customer is never found, and their old name, email or phone finds none of their bookings either (their contact was cleared; the reference still finds a booking).\n- `movies`, `people`, `theaters` (admins only): movies in any status, drafts and archived included, by title or cast; every person by name; theaters in any status by name or district. **Null for box office**, whose dashboard has no catalog screens.\n\nMatching is case-insensitive; ranking: the whole value, then a value starting with the query, then one containing it, then a typo-tolerant match, the closest first. Each group says whether more matched (`hasMore`); open the full list with the same `q` (`GET /admin/bookings?q=`, `GET /admin/customers?q=`, the catalog lists). Personal data: `Cache-Control: private, no-store`.",
  })
  @ApiOkResponse({
    type: AdminSearchResultsResponse,
    description: 'The results, grouped by what the role may see',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'SERVICE_UNAVAILABLE')
  async searchStaff(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Query() query: SearchQuery,
  ): Promise<AdminSearchResultsResponse> {
    return this.mapper.staffResults(await this.search.searchStaff(query.q, principal.role));
  }
}
