import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Admin } from '../../common/auth/access.decorators';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { AdminOverviewQuery } from './dto/admin-overview.query';
import { AdminOverviewResponse } from './dto/admin-overview.response';
import { OverviewResponseMapper } from './overview-response.mapper';
import { OverviewService } from './overview.service';

/**
 * The admin Overview `/admin` (PRD A1; design §11, §13.3), admins only. Its "Needs attention"
 * list is the bell's: `GET /admin/alerts`.
 */
@ApiTags('Admin: overview')
@Controller('admin/overview')
export class AdminOverviewController {
  constructor(
    private readonly overview: OverviewService,
    private readonly mapper: OverviewResponseMapper,
  ) {}

  @Get()
  @Admin()
  @ApiOperation({
    summary: 'The Overview of a period',
    description:
      'Admins only (a box office token is `FORBIDDEN`): every number of the Overview (PRD A1) for a period of cinema days (06:00 to 06:00 Cairo time) and all theaters or one (`theaterId`). Computed now from the bookings, showtimes and payments, after settling due slow payments; nothing is cached.\n\n- Period: `period=today|7d|30d` (the server decides today\'s cinema day), or `dateFrom` / `dateTo` (inclusive, at most 366 days), never both; neither is the last 7 cinema days.\n- `kpis`: Revenue (totals of Confirmed and Completed bookings, on the cinema day of their showtime; a refunded booking drops out), Tickets sold (their seats), Occupancy (tickets ÷ seats on sale of the scheduled showtimes), Avg. ticket (revenue ÷ tickets) and Counter share (the money taken at the box office ÷ all of it). Each card has `previous` and `change` against `comparison`: a single day against the same weekday last week, a longer period against the days just before it.\n- `byTheater` ("Revenue by theater" with Online / Counter and VS PREV), `byHall` (with `theaterId` only), `paymentMethods`, `topMovies` (5), `heatmap` (weekday × start-time slot, % of seats sold), `revenueTrend` (the 30 cinema days ending on `dateTo`, per theater), `tonight` (today\'s showtimes still to end, whatever the period).\n- Ratios have 4 decimals (0.4567 is 45.67%) and are null when there is nothing to divide by; money is piastres.\n- "Needs attention" is `GET /admin/alerts`; "Export CSV" follows (U19).\n- `period` with dates, a bad date, `dateTo` before `dateFrom` or over 366 days: `VALIDATION_FAILED`. An unknown `theaterId`: `NOT_FOUND`.',
  })
  @ApiOkResponse({
    type: AdminOverviewResponse,
    description: 'The Overview',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'SERVICE_UNAVAILABLE')
  async getOverview(@Query() query: AdminOverviewQuery): Promise<AdminOverviewResponse> {
    return this.mapper.overview(
      await this.overview.read({
        period: query.period,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        theaterId: query.theaterId,
      }),
    );
  }
}
