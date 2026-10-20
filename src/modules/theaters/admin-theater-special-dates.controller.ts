import { Body, Controller, Delete, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Admin, CurrentPrincipal } from '../../common/auth/access.decorators';
import type { StaffPrincipal } from '../../common/auth/types';
import { Strict } from '../../common/idempotency/idempotency.decorators';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { CreateSpecialDateRequest } from './dto/create-special-date.request';
import { SpecialDateResponse } from './dto/special-date.response';
import { SpecialDateParams, TheaterIdParams } from './dto/theater-id.params';
import { UpdateSpecialDateRequest } from './dto/update-special-date.request';
import { TheaterSpecialDatesService } from './theater-special-dates.service';
import { toSpecialDateResponse } from './theater-response.mapper';

@ApiTags('Admin: theaters')
@Controller('admin/theaters/:id/special-dates')
export class AdminTheaterSpecialDatesController {
  constructor(private readonly specialDates: TheaterSpecialDatesService) {}

  @Post()
  @Admin()
  @Strict()
  @ApiOperation({
    summary: 'Add a special date',
    description:
      "Admin only: holiday hours on the Opening hours tab. Replaces the weekly hours of one cinema date (06:00 to 06:00), with other hours or closed, for opening hours, scheduling and the customer pages. Today's cinema date or later, and one per date (`CONFLICT` otherwise). Existing showtimes are not changed or checked. Recorded in the activity log.",
  })
  @ApiBody({ type: CreateSpecialDateRequest })
  @ApiCreatedResponse({
    type: SpecialDateResponse,
    description: 'The new special date',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'CONFLICT')
  async createSpecialDate(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: TheaterIdParams,
    @Body() body: CreateSpecialDateRequest,
  ): Promise<SpecialDateResponse> {
    return toSpecialDateResponse(await this.specialDates.create(principal, params.id, body));
  }

  @Patch(':specialDateId')
  @Admin()
  @ApiOperation({
    summary: 'Change a special date',
    description:
      "Admin only: any of its date, label and hours. Times left out keep their value, and the result is checked as a whole. A special date before today's cinema date can only be deleted. A request that changes nothing answers `200` and records nothing. Recorded in the activity log.",
  })
  @ApiBody({ type: UpdateSpecialDateRequest })
  @ApiOkResponse({
    type: SpecialDateResponse,
    description: 'The special date after the change',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'CONFLICT')
  async updateSpecialDate(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: SpecialDateParams,
    @Body() body: UpdateSpecialDateRequest,
  ): Promise<SpecialDateResponse> {
    return toSpecialDateResponse(
      await this.specialDates.update(principal, params.id, params.specialDateId, body),
    );
  }

  @Delete(':specialDateId')
  @Admin()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a special date',
    description:
      'Admin only: the weekly hours apply to that cinema date again. Past special dates can be deleted too. Recorded in the activity log.',
  })
  @ApiNoContentResponse({ description: 'Deleted', headers: REQUEST_ID_RESPONSE_HEADER })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async deleteSpecialDate(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: SpecialDateParams,
  ): Promise<void> {
    await this.specialDates.delete(principal, params.id, params.specialDateId);
  }
}
