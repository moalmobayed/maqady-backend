import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, Staff } from '../../common/auth/access.decorators';
import type { StaffPrincipal } from '../../common/auth/types';
import { PageQuery } from '../../common/pagination/dto/page-query.dto';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { AlertsResponseMapper } from './alerts-response.mapper';
import { AlertsService } from './alerts.service';
import { AdminAlertPageResponse, AlertReadResultResponse } from './dto/admin-alert.response';
import { AlertReadsRequest } from './dto/alert-reads.request';

/**
 * The bell and its Notifications panel (PRD "Notifications panel", A1 "Needs attention"; design
 * §11, §13.3), for both staff roles: the current alerts with the caller's read state, and marking
 * them read.
 */
@ApiTags('Admin: alerts')
@Controller('admin')
export class AdminAlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly mapper: AlertsResponseMapper,
  ) {}

  @Get('alerts')
  @Staff()
  @ApiOperation({
    summary: 'The current alerts and the unread count',
    description:
      "Staff (box office or admin): the Notifications panel and the bell's badge (`unreadCount`). Alerts are computed now from the stored facts, after settling due slow payments; none is raised by a timer, so a condition that no longer holds is simply not listed.\n\n- `failed_payments`: online payments (card, wallet) declined or closed at the wallet on today's cinema day, one alert with the count. Key `failed-payments:<cinemaDate>:<count>`: another failure makes a new key, unread again.\n- `low_sales`: each showtime later today (not started yet) under 35% sold (Confirmed seats ÷ seats). Key `low-sales:<showtimeId>`.\n- `hall_gap`: each active hall of an active theater with no scheduled showtime on a cinema day of the next 7 (today included) when the theater is open. Key `hall-gap:<hallId>:<cinemaDate>`.\n\nThe same condition always has the same key, so it is listed once, for every staff member alike. `read` is the signed-in member's own: marking keys read (`POST /admin/alert-reads`) changes nobody else's badge. Unread first, then by kind and time; cursor-paged over the current list, with `total` and `unreadCount` for the whole list.",
  })
  @ApiOkResponse({
    type: AdminAlertPageResponse,
    description: 'One page of alerts, with the badge',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'SERVICE_UNAVAILABLE')
  async listAlerts(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Query() query: PageQuery,
  ): Promise<AdminAlertPageResponse> {
    return this.mapper.page(
      await this.alerts.page(principal.id, { cursor: query.cursor, limit: query.limit }),
    );
  }

  @Post('alert-reads')
  @Staff()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mark alerts read',
    description:
      'Staff (box office or admin): marks alerts read for the signed-in member only, the alerts whose `key` is in `keys` (opening one) or every current alert when `keys` is omitted ("Mark all as read"). Answers the badge after it.\n\n- A key that is not a current alert (resolved since, or replaced by a newer failed-payments count) is ignored, so a stale panel never hides a newer alert.\n- Marking a key twice is harmless: it keeps the first time it was read. No `Idempotency-Key` is needed; one is accepted.\n- A malformed key, an empty list or more than 200 keys: `VALIDATION_FAILED`.',
  })
  @ApiBody({ type: AlertReadsRequest, required: false })
  @ApiOkResponse({
    type: AlertReadResultResponse,
    description: 'What was marked, and the badge after it',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'SERVICE_UNAVAILABLE')
  async markAlertsRead(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Body() body: AlertReadsRequest,
  ): Promise<AlertReadResultResponse> {
    return this.mapper.readResult(await this.alerts.markRead(principal.id, body.keys));
  }
}
