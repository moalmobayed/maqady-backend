import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Admin } from '../../common/auth/access.decorators';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { ACTIVITY_CACHE_CONTROL } from './activity.constants';
import { ActivityResponseMapper } from './activity-response.mapper';
import { ActivityService } from './activity.service';
import { ActivityEventPageResponse } from './dto/activity-event.response';
import { ActivityQuery } from './dto/activity.query';

/** The admin Activity log page (PRD "Activity log" `/admin/activity`; design §11, §13.5). */
@ApiTags('Admin: activity')
@Controller('admin/activity')
export class ActivityController {
  constructor(
    private readonly activity: ActivityService,
    private readonly mapper: ActivityResponseMapper,
  ) {}

  @Get()
  @Admin()
  @Header('Cache-Control', ACTIVITY_CACHE_CONTROL)
  @ApiOperation({
    summary: 'The Activity log',
    description:
      'Admins only (a box office token is `FORBIDDEN`): who did what across the dashboard (PRD "Activity log"), every recorded event, newest first, cursor-paged with `total` under the same filters. Never cached (`Cache-Control: private, no-store`).\n\n- Each event: time (`occurredAt`, `cinemaDate`), who (`actor`: a staff member by name, a customer by id only, or the system), what (`action`, `changedFields`, `metadata`) and which item (`entity`; `booking.reference` for booking and payment events).\n- No personal data: events record the names of changed fields, never their values, and their metadata holds no name, email or phone. Every staff change, booking event and CSV export is here (`export.downloaded`).\n- Filters combine: `staffUserId` (a staff member\'s actions), `actorKind`, `entityType` (with `entityId` for one item), `action`, `dateFrom` / `dateTo` (cinema dates, inclusive).\n- `entityId` without `entityType`, `dateTo` before `dateFrom`, or a malformed filter or cursor: `VALIDATION_FAILED`.',
  })
  @ApiOkResponse({
    type: ActivityEventPageResponse,
    description: 'One page of events',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'SERVICE_UNAVAILABLE')
  async listActivity(@Query() query: ActivityQuery): Promise<ActivityEventPageResponse> {
    return this.mapper.page(
      await this.activity.list(
        {
          staffUserId: query.staffUserId,
          actorKind: query.actorKind,
          entityType: query.entityType,
          entityId: query.entityId,
          action: query.action,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
        },
        { cursor: query.cursor, limit: query.limit },
      ),
    );
  }
}
