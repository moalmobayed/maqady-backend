import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { MoneyResponse } from '../../../common/money/dto/money-response.dto';
import { PageResponseOf } from '../../../common/pagination/dto/page-response.dto';
import { AdminBookingListItemResponse } from '../../bookings/dto/admin-booking-list-item.response';
import { CUSTOMER_STATUSES } from '../../customers/enums';
import type { CustomerStatus } from '../../customers/types';
import { RECENT_BOOKINGS_LIMIT } from '../admin-customers.constants';

/** The drawer's stats (PRD A7): Bookings, Spent and No-shows, plus the LAST BOOKING column. */
@ApiSchema({ name: 'CustomerStats' })
export class CustomerStatsResponse {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 6,
    description:
      'Paid bookings the customer holds: Confirmed and Completed (online or at the counter). A refunded booking no longer counts.',
  })
  bookings!: number;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description:
      'The totals of those bookings (after any edit): what the customer has paid and kept. Zero with none.',
  })
  spent!: MoneyResponse;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 1,
    description:
      'No-shows: those bookings whose showtime has ended and that were never scanned at the entrance. A show not yet over is never a no-show.',
  })
  noShows!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-16T19:02:00+03:00',
    description: 'When the newest of those bookings was made; null with none.',
  })
  lastBookingAt!: string | null;
}

/**
 * A customer as the admin Customers table shows them (PRD A7): CUSTOMER (name, email), PHONE,
 * JOINED, BOOKINGS, SPENT, LAST BOOKING and STATUS. Also the answer of `PATCH`.
 */
@ApiSchema({ name: 'AdminCustomer' })
export class AdminCustomerResponse {
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
    description: 'The sign-in email.',
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
    enum: CUSTOMER_STATUSES,
    enumName: 'CustomerStatus',
    nullable: false,
    example: 'active',
    description:
      '`active`, or `blocked` (signed out everywhere, refused at sign-in; paid tickets stay valid).',
  })
  status!: CustomerStatus;

  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: true,
    description: 'Whether the customer has verified the email.',
  })
  emailVerified!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-03-02T21:10:00+02:00',
    description: 'When the email was verified, or null while it is not.',
  })
  emailVerifiedAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-03-02T21:05:00+02:00',
    description: 'When the account was created (the JOINED column).',
  })
  joinedAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-16T18:40:00+03:00',
    description: 'The latest sign-in, or null when the customer never signed in.',
  })
  lastSignInAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T18:40:00+03:00',
    description: 'When the account last changed.',
  })
  updatedAt!: string;

  @ApiProperty({
    type: () => CustomerStatsResponse,
    nullable: false,
    description: 'Bookings, Spent, No-shows and Last booking.',
  })
  stats!: CustomerStatsResponse;
}

export const AdminCustomerPageResponse = PageResponseOf(AdminCustomerResponse);

/** The Customers drawer (PRD A7): the customer, their stats and their newest bookings. */
@ApiSchema({ name: 'AdminCustomerDetail' })
export class AdminCustomerDetailResponse extends AdminCustomerResponse {
  @ApiProperty({
    type: () => AdminBookingListItemResponse,
    isArray: true,
    nullable: false,
    maxItems: RECENT_BOOKINGS_LIMIT,
    description: `"Recent bookings": the customer's ${RECENT_BOOKINGS_LIMIT} newest bookings in any status, newest first, as the Bookings table shows them. Page through all of them with \`GET /admin/bookings?customerId=\`.`,
  })
  recentBookings!: AdminBookingListItemResponse[];
}
