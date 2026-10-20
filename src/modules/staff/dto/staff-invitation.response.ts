import { ApiProperty } from '@nestjs/swagger';
import { formatCairoIso } from '../../../common/time/time';
import type { StaffInvitation } from '../types';

/** `POST /admin/staff/{id}/invitations`: the invite just sent. */
export class StaffInvitationResponse {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    example: 3,
    description: 'The invited staff member.',
  })
  staffUserId!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-23T10:00:00+03:00',
    description: 'When the new link stops working: 72 hours after it was sent.',
  })
  expiresAt!: string;

  static from(invitation: StaffInvitation): StaffInvitationResponse {
    return Object.assign(new StaffInvitationResponse(), {
      staffUserId: invitation.staffUserId,
      expiresAt: formatCairoIso(invitation.expiresAt),
    });
  }
}
