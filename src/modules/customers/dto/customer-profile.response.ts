import { ApiProperty } from '@nestjs/swagger';
import { formatCairoIso } from '../../../common/time/time';
import type { Customer } from '../types';

/** The signed-in customer (PRD C12 Profile): who they are and whether the email is verified. */
export class CustomerProfileResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 42, description: 'Customer id.' })
  id!: number;

  @ApiProperty({
    type: String,
    nullable: false,
    example: 'Layla Hassan',
    description: 'Full name.',
  })
  fullName!: string;

  @ApiProperty({
    type: String,
    format: 'email',
    nullable: false,
    example: 'layla.hassan@example.com',
    description: 'The sign-in email, as registered. Read-only.',
  })
  email!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '+201012345678',
    description: 'Mobile number in international (E.164) form, or null when none is on file.',
  })
  phone!: string | null;

  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: false,
    description:
      'Show "Verified", or "Not verified" with a resend link (`POST /auth/email-verification-requests`). Verification blocks nothing.',
  })
  emailVerified!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-20T19:45:00+03:00',
    description: 'When the email was verified, or null while it is not.',
  })
  emailVerifiedAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-20T19:30:00+03:00',
    description: 'When the account was created, for "Member since".',
  })
  memberSince!: string;

  static from(customer: Customer): CustomerProfileResponse {
    return Object.assign(new CustomerProfileResponse(), {
      id: customer.id,
      fullName: customer.fullName ?? '',
      email: customer.email ?? '',
      phone: customer.phone,
      emailVerified: customer.emailVerifiedAt !== null,
      emailVerifiedAt:
        customer.emailVerifiedAt === null ? null : formatCairoIso(customer.emailVerifiedAt),
      memberSince: formatCairoIso(customer.createdAt),
    });
  }
}
