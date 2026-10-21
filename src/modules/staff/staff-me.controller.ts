import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, Staff } from '../../common/auth/access.decorators';
import type { StaffPrincipal } from '../../common/auth/types';
import { REQUEST_ID_RESPONSE_HEADER } from '../../common/swagger/error-responses';
import { StaffProfileResponse } from './dto/staff-profile.response';
import { StaffAuthService } from './staff-auth.service';

@ApiTags('Admin: auth')
@Controller('admin/me')
export class StaffMeController {
  constructor(private readonly staffAuth: StaffAuthService) {}

  @Get()
  @Staff()
  @ApiOperation({
    summary: 'The signed-in staff member',
    description:
      'Staff (either role): name, email and role for the dashboard shell, which shows only the screens the role may use. The role is read from the database on every request, so a role change shows on the next call.',
  })
  @ApiOkResponse({
    type: StaffProfileResponse,
    description: 'The signed-in member',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  async getStaffProfile(
    @CurrentPrincipal() principal: StaffPrincipal,
  ): Promise<StaffProfileResponse> {
    return StaffProfileResponse.from(await this.staffAuth.profile(principal));
  }
}
