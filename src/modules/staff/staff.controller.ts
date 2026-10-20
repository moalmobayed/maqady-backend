import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Admin, CurrentPrincipal } from '../../common/auth/access.decorators';
import type { StaffPrincipal } from '../../common/auth/types';
import { toPageRequest } from '../../common/pagination/cursor';
import type { Page } from '../../common/pagination/types';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { StaffListQuery } from './dto/staff-list.query';
import { StaffMemberResponsePage } from './dto/staff-member-page.response';
import { StaffMemberParams } from './dto/staff-member.params';
import { StaffMemberResponse } from './dto/staff-member.response';
import { UpdateStaffMemberRequest } from './dto/update-staff-member.request';
import { StaffService } from './staff.service';

@ApiTags('Admin: staff')
@Controller('admin/staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  @Admin()
  @ApiOperation({
    summary: 'List staff members',
    description:
      'Admin only: the Staff screen. Every member with name, email, role, status and last sign-in, ordered by name, optionally filtered by role and status. Cursor-paginated: pass `nextCursor` back as `cursor`.',
  })
  @ApiOkResponse({
    type: StaffMemberResponsePage,
    description: 'One page of staff members',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED')
  async listStaff(@Query() query: StaffListQuery): Promise<Page<StaffMemberResponse>> {
    const page = await this.staffService.list(
      {
        ...(query.role !== undefined ? { role: query.role } : {}),
        ...(query.status !== undefined ? { status: query.status } : {}),
      },
      toPageRequest(query, 'text'),
    );
    return { ...page, items: page.items.map((member) => StaffMemberResponse.from(member)) };
  }

  @Patch(':id')
  @Admin()
  @ApiOperation({
    summary: "Change a staff member's role or status",
    description:
      "Admin only: change role, deactivate, or reactivate. Changes take effect on the member's next request.\n\n- There is always at least one active admin: demoting or deactivating the only one is `LAST_ADMIN`, also when two admins change each other at the same moment. Admins may change themselves within that rule.\n- Deactivating signs the member out everywhere and voids their unused invite and reset links. Demoting an admin signs them out, so they sign in again as box office.\n- Reactivating a member who never set a password returns them to `invited`.\n- A change to the values the member already has answers `200` and changes nothing.\n- Recorded in the activity log with the names of the changed fields.",
  })
  @ApiBody({ type: UpdateStaffMemberRequest })
  @ApiOkResponse({
    type: StaffMemberResponse,
    description: 'The member after the change',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'LAST_ADMIN')
  async updateStaffMember(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: StaffMemberParams,
    @Body() body: UpdateStaffMemberRequest,
  ): Promise<StaffMemberResponse> {
    const member = await this.staffService.updateMember(principal, params.id, {
      ...(body.role !== undefined ? { role: body.role } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    });
    return StaffMemberResponse.from(member);
  }
}
