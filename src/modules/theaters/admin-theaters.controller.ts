import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
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
import { money } from '../../common/money/money';
import { toPageRequest } from '../../common/pagination/cursor';
import type { Page } from '../../common/pagination/types';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { CreateTheaterRequest } from './dto/create-theater.request';
import { ReplaceFacilitiesRequest } from './dto/replace-facilities.request';
import { ReplaceHoursRequest } from './dto/replace-hours.request';
import { ReplacePhonesRequest } from './dto/replace-phones.request';
import { ReplacePricesRequest } from './dto/replace-prices.request';
import { TheaterIdParams } from './dto/theater-id.params';
import { TheaterListItemResponse } from './dto/theater-list-item.response';
import { TheaterListQuery } from './dto/theater-list.query';
import { TheaterListItemResponsePage } from './dto/theater-page.response';
import { TheaterResponse } from './dto/theater.response';
import { UpdateTheaterRequest } from './dto/update-theater.request';
import { TheaterResponseMapper } from './theater-response.mapper';
import { TheatersService } from './theaters.service';

const THEATER_OK = {
  type: TheaterResponse,
  description: 'The theater after the change',
  headers: REQUEST_ID_RESPONSE_HEADER,
};

@ApiTags('Admin: theaters')
@Controller('admin/theaters')
export class AdminTheatersController {
  constructor(
    private readonly theaters: TheatersService,
    private readonly mapper: TheaterResponseMapper,
  ) {}

  @Get()
  @Admin()
  @ApiOperation({
    summary: 'List theaters',
    description:
      "Admin only: the Theaters & halls list. Every theater in any status with its address, cover, main phone, today's hours and whether it is open now, ordered by name, optionally filtered by status. Cursor-paginated: pass `nextCursor` back as `cursor`.",
  })
  @ApiOkResponse({
    type: TheaterListItemResponsePage,
    description: 'One page of theaters',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED')
  async listTheaters(@Query() query: TheaterListQuery): Promise<Page<TheaterListItemResponse>> {
    const page = await this.theaters.list(
      query.status !== undefined ? { status: query.status } : {},
      toPageRequest(query, 'text'),
    );
    return { ...page, items: page.items.map((entry) => this.mapper.toListItemResponse(entry)) };
  }

  @Post()
  @Admin()
  @Strict()
  @ApiOperation({
    summary: 'Create a theater',
    description:
      'Admin only: the New theater wizard. The theater is created as a `draft`, hidden from customers. Set its hours, phones, facilities, prices and photos next, then publish it with `PATCH` `status: active`. The name is unique, ignoring letter case. Recorded in the activity log.',
  })
  @ApiBody({ type: CreateTheaterRequest })
  @ApiCreatedResponse({
    type: TheaterResponse,
    description: 'The new draft theater',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'CONFLICT')
  async createTheater(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Body() body: CreateTheaterRequest,
  ): Promise<TheaterResponse> {
    return this.mapper.toTheaterResponse(await this.theaters.create(principal, body));
  }

  @Get(':id')
  @Admin()
  @ApiOperation({
    summary: 'Get a theater',
    description:
      'Admin only: the theater page, in any status. Location, contacts, facilities, weekly hours, special dates from today on, default prices, cover and gallery, whether it is open now, and for a draft what it still needs before it can be published.',
  })
  @ApiOkResponse({
    type: TheaterResponse,
    description: 'The theater',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async getTheater(@Param() params: TheaterIdParams): Promise<TheaterResponse> {
    return this.mapper.toTheaterResponse(await this.theaters.view(params.id));
  }

  @Patch(':id')
  @Admin()
  @ApiOperation({
    summary: 'Change, publish or pause a theater',
    description:
      'Admin only: edits the Location and Contacts fields, and changes the status, in one transaction (fields first).\n\n- `status: active` on a draft publishes it. It needs the zone prices, the weekly hours (all seven days set, at least one open) and an active hall; otherwise `THEATER_NOT_PUBLISHABLE`, with `details.missing` naming what is missing.\n- `sales_paused` and `active` toggle selling on a published theater. A paused theater is hidden from customers; existing tickets stay valid.\n- A published theater never returns to `draft`, and a draft cannot be paused: `CONFLICT` with `details.from` and `details.to`.\n- A request that changes nothing answers `200` and records nothing.\n- Recorded in the activity log with the names of the changed fields.',
  })
  @ApiBody({ type: UpdateTheaterRequest })
  @ApiOkResponse(THEATER_OK)
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'CONFLICT', 'THEATER_NOT_PUBLISHABLE')
  async updateTheater(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: TheaterIdParams,
    @Body() body: UpdateTheaterRequest,
  ): Promise<TheaterResponse> {
    // Fields left out are undefined, and the service changes only the ones sent.
    return this.mapper.toTheaterResponse(await this.theaters.update(principal, params.id, body));
  }

  @Delete(':id')
  @Admin()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a draft theater',
    description:
      'Admin only. Only a draft with no showtimes can be deleted; any other theater is paused instead (`THEATER_NOT_DELETABLE`, with `details.reasons`). Deleting removes its phones, facilities, hours, special dates, cover and gallery, and the image files. Recorded in the activity log.',
  })
  @ApiNoContentResponse({ description: 'Deleted', headers: REQUEST_ID_RESPONSE_HEADER })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'THEATER_NOT_DELETABLE')
  async deleteTheater(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: TheaterIdParams,
  ): Promise<void> {
    await this.theaters.delete(principal, params.id);
  }

  @Put(':id/hours')
  @Admin()
  @ApiOperation({
    summary: "Replace a theater's weekly hours",
    description:
      'Admin only: the Opening hours tab. All seven weekdays of the cinema date (06:00 to 06:00), each closed or open from `opens` to `closes` in Cairo time; a `closes` at or before 06:00 is the next morning. Special dates override single days. Existing showtimes are not changed or checked; new showtimes must fit the new hours. Recorded in the activity log.',
  })
  @ApiBody({ type: ReplaceHoursRequest })
  @ApiOkResponse(THEATER_OK)
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async replaceHours(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: TheaterIdParams,
    @Body() body: ReplaceHoursRequest,
  ): Promise<TheaterResponse> {
    return this.mapper.toTheaterResponse(
      await this.theaters.replaceHours(principal, params.id, body.days),
    );
  }

  @Put(':id/phones')
  @Admin()
  @ApiOperation({
    summary: "Replace a theater's phones",
    description:
      'Admin only: the Contacts tab. The whole list of labelled numbers, in display order; the first is the main phone on cards. The website shows phones only while `showContactsPublic` is true. Recorded in the activity log (the count, never the numbers).',
  })
  @ApiBody({ type: ReplacePhonesRequest })
  @ApiOkResponse(THEATER_OK)
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async replacePhones(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: TheaterIdParams,
    @Body() body: ReplacePhonesRequest,
  ): Promise<TheaterResponse> {
    return this.mapper.toTheaterResponse(
      await this.theaters.replacePhones(
        principal,
        params.id,
        body.phones.map(({ label, number }) => ({ label, number })),
      ),
    );
  }

  @Put(':id/facilities')
  @Admin()
  @ApiOperation({
    summary: "Replace a theater's facilities",
    description: 'Admin only: the Facilities tab. The whole set. Recorded in the activity log.',
  })
  @ApiBody({ type: ReplaceFacilitiesRequest })
  @ApiOkResponse(THEATER_OK)
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async replaceFacilities(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: TheaterIdParams,
    @Body() body: ReplaceFacilitiesRequest,
  ): Promise<TheaterResponse> {
    return this.mapper.toTheaterResponse(
      await this.theaters.replaceFacilities(principal, params.id, body.facilities),
    );
  }

  @Put(':id/prices')
  @Admin()
  @ApiOperation({
    summary: "Replace a theater's default zone prices",
    description:
      'Admin only: the Pricing tab. One default price per seat zone (Front, Middle, Back), in one currency. A new showtime copies them; existing showtimes keep their prices. Once set they can be changed, never removed: a published theater always has them. Recorded in the activity log.',
  })
  @ApiBody({ type: ReplacePricesRequest })
  @ApiOkResponse(THEATER_OK)
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async replacePrices(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: TheaterIdParams,
    @Body() body: ReplacePricesRequest,
  ): Promise<TheaterResponse> {
    const { front, middle, back } = body;
    return this.mapper.toTheaterResponse(
      await this.theaters.replacePrices(principal, params.id, {
        front: money(front.amount, front.currency),
        middle: money(middle.amount, middle.currency),
        back: money(back.amount, back.currency),
      }),
    );
  }
}
