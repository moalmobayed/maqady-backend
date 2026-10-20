import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
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
import { InviteStaffMemberRequest } from './dto/invite-staff-member.request';
import { StaffInvitationResponse } from './dto/staff-invitation.response';
import { StaffListQuery } from './dto/staff-list.query';
import { StaffMemberResponsePage } from './dto/staff-member-page.response';
import { StaffMemberParams } from './dto/staff-member.params';
import { StaffMemberResponse } from './dto/staff-member.response';
import { UpdateStaffMemberRequest } from './dto/update-staff-member.request';
import { StaffOnboardingService } from './staff-onboarding.service';
import { StaffService } from './staff.service';

@ApiTags('Admin: staff')
@Controller('admin/staff')
export class StaffController {
  constructor(
    private readonly staffService: StaffService,
    private readonly onboarding: StaffOnboardingService,
  ) {}

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

  @Post()
  @Admin()
  @Strict()
  @ApiOperation({
    summary: 'Invite a staff member',
    description:
      'Admin only: the Staff screen\'s Invite form. Creates the member as `invited` with the given name, email and role, and emails them a link to `/admin/set-password` that works once, for 72 hours. They become `active` when they set a password there, and then sign in.\n\n- An email already used by any staff member, whatever the letter case and status, is `EMAIL_TAKEN`; nothing is sent.\n- The link is only in the email: the response and the Message log never show it. Use "Resend invite" if it expired.\n- Requires `Idempotency-Key`: a retry with the same key returns the same member and sends no second email.\n- Recorded in the activity log.',
  })
  @ApiBody({ type: InviteStaffMemberRequest })
  @ApiCreatedResponse({
    type: StaffMemberResponse,
    description: 'The invited member, `status: invited`',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'EMAIL_TAKEN')
  async inviteStaffMember(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Body() body: InviteStaffMemberRequest,
  ): Promise<StaffMemberResponse> {
    const member = await this.onboarding.invite(principal, {
      email: body.email,
      fullName: body.fullName,
      role: body.role,
    });
    return StaffMemberResponse.from(member);
  }

  @Post(':id/invitations')
  @Admin()
  @Strict()
  @ApiOperation({
    summary: 'Resend an invite',
    description:
      'Admin only: the Staff screen\'s "Resend invite" for an `invited` member. Emails a new 72-hour set-password link; the previous link stops working at once.\n\n- Only a member who is still `invited` can get one: an active or deactivated member is `NOT_INVITED` (an active member uses "Forgot password"; reactivating a deactivated member who never set a password makes them `invited` again).\n- Requires `Idempotency-Key`: a retry with the same key sends no second email.\n- Recorded in the activity log.',
  })
  @ApiCreatedResponse({
    type: StaffInvitationResponse,
    description: 'The invite was sent',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'NOT_INVITED')
  async resendInvitation(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: StaffMemberParams,
  ): Promise<StaffInvitationResponse> {
    return StaffInvitationResponse.from(await this.onboarding.resendInvite(principal, params.id));
  }
}
