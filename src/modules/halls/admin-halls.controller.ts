import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Put } from '@nestjs/common';
import {
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Admin, CurrentPrincipal } from '../../common/auth/access.decorators';
import type { StaffPrincipal } from '../../common/auth/types';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { HallIdParams } from './dto/hall-id.params';
import { HallLayoutResponse } from './dto/hall-layout.response';
import { HallResponse } from './dto/hall.response';
import { ReplaceHallLayoutRequest } from './dto/replace-hall-layout.request';
import { UpdateHallRequest } from './dto/update-hall.request';
import { HallLayoutService } from './hall-layout.service';
import { toHallLayoutResponse, toHallResponse } from './hall-response.mapper';
import { HallsService } from './halls.service';

const LAYOUT_OK = {
  type: HallLayoutResponse,
  description: 'The layout',
  headers: REQUEST_ID_RESPONSE_HEADER,
};

@ApiTags('Admin: halls')
@Controller('admin/halls')
export class AdminHallsController {
  constructor(
    private readonly halls: HallsService,
    private readonly layouts: HallLayoutService,
  ) {}

  @Get(':id')
  @Admin()
  @ApiOperation({
    summary: 'Get a hall',
    description:
      'Admin only: the hall layout editor header. The hall in any status, with its layout size, seat counts and whether it can be deleted.',
  })
  @ApiOkResponse({
    type: HallResponse,
    description: 'The hall',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async getHall(@Param() params: HallIdParams): Promise<HallResponse> {
    return toHallResponse(await this.halls.view(params.id));
  }

  @Patch(':id')
  @Admin()
  @ApiOperation({
    summary: 'Rename, activate or retire a hall',
    description:
      "Admin only: renames the hall and changes its status, in one transaction (name first).\n\n- `status: active` on a draft makes it schedulable; a theater is published only with an active hall.\n- `status: retired` (from draft or active) keeps the hall for history and hides it from scheduling. It needs no scheduled showtime that has not ended (`HALL_NOT_RETIRABLE`, with `details.reasons`). Retiring is final. Retiring the last active hall of a published theater is allowed: the theater stays published.\n- Any other status change (back to draft, out of retired) is `CONFLICT` with `details.from` and `details.to`.\n- The name is unique among the theater's halls, ignoring letter case (`CONFLICT`).\n- A request that changes nothing answers `200` and records nothing.\n- Recorded in the activity log.",
  })
  @ApiBody({ type: UpdateHallRequest })
  @ApiOkResponse({
    type: HallResponse,
    description: 'The hall after the change',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'CONFLICT', 'HALL_NOT_RETIRABLE')
  async updateHall(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: HallIdParams,
    @Body() body: UpdateHallRequest,
  ): Promise<HallResponse> {
    return toHallResponse(
      await this.halls.update(principal, params.id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      }),
    );
  }

  @Delete(':id')
  @Admin()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a hall',
    description:
      'Admin only. Only a hall that never had a showtime can be deleted, in any status; any other is retired instead (`HALL_NOT_DELETABLE`, with `details.reasons`). Its layout goes with it. Recorded in the activity log.',
  })
  @ApiNoContentResponse({ description: 'Deleted', headers: REQUEST_ID_RESPONSE_HEADER })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'HALL_NOT_DELETABLE')
  async deleteHall(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: HallIdParams,
  ): Promise<void> {
    await this.halls.delete(principal, params.id);
  }

  @Get(':id/layout')
  @Admin()
  @ApiOperation({
    summary: "Get a hall's layout",
    description:
      'Admin only: the hall layout editor. The grid size, the zone of each row (front to back), the wheelchair spaces and gaps, the aisles (`aisleAfter`, computed) and the seat summary. Every cell not in `seatMarks` is a seat.',
  })
  @ApiOkResponse(LAYOUT_OK)
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async getLayout(@Param() params: HallIdParams): Promise<HallLayoutResponse> {
    return toHallLayoutResponse(await this.layouts.get(params.id));
  }

  @Put(':id/layout')
  @Admin()
  @ApiOperation({
    summary: "Replace a hall's layout",
    description:
      'Admin only: "Save" in the hall layout editor. Replaces the whole layout (row count, seats per row, row zones, seat marks) in one transaction: it all applies or nothing does.\n\n- Rows 4–15, lettered A to P without I from the screen back; seats per row 8–20, numbered from 1 on the left. Aisles fall after seat 4 and 4 seats before the end; they are reported in `aisleAfter`, never sent.\n- `rowZones` holds one zone per row and runs in bands from the screen back (front, then middle, then back; any band may be empty).\n- Each seat mark lies inside the new grid, at most one per seat, and at least one seat remains. Every problem is reported at once in `VALIDATION_FAILED` `details.fields`, with paths such as `seatMarks.3.seatNumber`.\n- The save waits for seat holds in progress, then is refused with `HALL_IN_USE` while a showtime in the hall that has not ended has seats held or sold; `details.showtimes` names them.\n- A retired hall\'s layout cannot change (`CONFLICT`, `details.status: retired`).\n- Upcoming showtimes take the new seat count. Recorded in the activity log.',
  })
  @ApiBody({ type: ReplaceHallLayoutRequest })
  @ApiOkResponse({ ...LAYOUT_OK, description: 'The saved layout' })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'CONFLICT', 'HALL_IN_USE')
  async replaceLayout(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: HallIdParams,
    @Body() body: ReplaceHallLayoutRequest,
  ): Promise<HallLayoutResponse> {
    return toHallLayoutResponse(
      await this.layouts.replace(principal, params.id, {
        rowCount: body.rowCount,
        seatsPerRow: body.seatsPerRow,
        rowZones: body.rowZones,
        seatMarks: body.seatMarks.map(({ rowLabel, seatNumber, kind }) => ({
          rowLabel,
          seatNumber,
          kind,
        })),
      }),
    );
  }
}
