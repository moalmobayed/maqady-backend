import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Admin, CurrentPrincipal } from '../../common/auth/access.decorators';
import type { StaffPrincipal } from '../../common/auth/types';
import { Strict } from '../../common/idempotency/idempotency.decorators';
import { toPageRequest } from '../../common/pagination/cursor';
import type { Page } from '../../common/pagination/types';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { TheaterIdParams } from '../theaters/dto/theater-id.params';
import { CreateHallRequest } from './dto/create-hall.request';
import { HallListQuery } from './dto/hall-list.query';
import { HallResponsePage } from './dto/hall-page.response';
import { HallResponse } from './dto/hall.response';
import { toHallResponse } from './hall-response.mapper';
import { HallsService } from './halls.service';

@ApiTags('Admin: halls')
@Controller('admin/theaters/:id/halls')
export class AdminTheaterHallsController {
  constructor(private readonly halls: HallsService) {}

  @Get()
  @Admin()
  @ApiOperation({
    summary: "List a theater's halls",
    description:
      "Admin only: the theater's Halls tab. Every hall in any status, optionally filtered by status, ordered by name, with its layout size, seat counts and whether it can be deleted (else it can only be retired). Cursor-paginated: pass `nextCursor` back as `cursor`. An unknown theater is `NOT_FOUND`.",
  })
  @ApiOkResponse({
    type: HallResponsePage,
    description: 'One page of halls',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async listHalls(
    @Param() params: TheaterIdParams,
    @Query() query: HallListQuery,
  ): Promise<Page<HallResponse>> {
    const page = await this.halls.list(
      params.id,
      query.status !== undefined ? { status: query.status } : {},
      toPageRequest(query, 'text'),
    );
    return { ...page, items: page.items.map(toHallResponse) };
  }

  @Post()
  @Admin()
  @Strict()
  @ApiOperation({
    summary: 'Add a hall',
    description:
      'Admin only: "Add hall" on the Halls tab. The hall is created as a `draft` with the standard 12 × 16 layout (rows A–C front, D–H middle, J–M back, 192 seats); edit it with `PUT /admin/halls/{id}/layout`, then activate it with `PATCH` `status: active`. A theater is published only with an active hall. The name is unique among the theater\'s halls, ignoring letter case (`CONFLICT`). Recorded in the activity log.',
  })
  @ApiBody({ type: CreateHallRequest })
  @ApiCreatedResponse({
    type: HallResponse,
    description: 'The new draft hall',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'CONFLICT')
  async createHall(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: TheaterIdParams,
    @Body() body: CreateHallRequest,
  ): Promise<HallResponse> {
    return toHallResponse(await this.halls.create(principal, params.id, body.name));
  }
}
