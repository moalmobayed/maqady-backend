import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { AdminBookingListItemResponse } from '../../bookings/dto/admin-booking-list-item.response';
import { CUSTOMER_STATUSES } from '../../customers/enums';
import type { CustomerStatus } from '../../customers/types';
import {
  SearchMovieGroupResponse,
  SearchPersonGroupResponse,
  SearchTheaterGroupResponse,
} from './search.response';

/** A live customer account found by name, email or phone. */
@ApiSchema({ name: 'AdminSearchCustomer' })
export class AdminSearchCustomerResponse {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    example: 42,
    description: 'Customer id: open the drawer with `GET /admin/customers/{id}`.',
  })
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
    description: '`active`, or `blocked` (cannot sign in).',
  })
  status!: CustomerStatus;

  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: true,
    description: 'Whether the customer verified their email.',
  })
  emailVerified!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-09-02T18:20:00+03:00',
    description: 'When the account was created (JOINED).',
  })
  joinedAt!: string;
}

@ApiSchema({ name: 'AdminSearchBookingGroup' })
export class AdminSearchBookingGroupResponse {
  @ApiProperty({
    type: () => [AdminBookingListItemResponse],
    nullable: false,
    description:
      'Rows as the Bookings table shows them, statuses decided now. A whole reference finds exactly that booking; otherwise the best match of the contact name (whole, start, part, then with a typo), email or phone first, newest first among equals. At most 10. Empty when nothing matches.',
  })
  items!: AdminBookingListItemResponse[];

  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: false,
    description:
      'True when more bookings matched than are listed: see all with `GET /admin/bookings?q=`.',
  })
  hasMore!: boolean;
}

@ApiSchema({ name: 'AdminSearchCustomerGroup' })
export class AdminSearchCustomerGroupResponse {
  @ApiProperty({
    type: () => [AdminSearchCustomerResponse],
    nullable: false,
    description:
      'Live accounts, best match first (name, then email, then phone), newest first among equals. A deleted (anonymised) account is never found. At most 10. Empty when nothing matches.',
  })
  items!: AdminSearchCustomerResponse[];

  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: false,
    description:
      'True when more customers matched than are listed: see all with `GET /admin/customers?q=`.',
  })
  hasMore!: boolean;
}

/**
 * `GET /admin/search`: the dashboard's search results, grouped and limited to what the role may
 * see. The catalog groups are null for box office.
 */
@ApiSchema({ name: 'AdminSearchResults' })
export class AdminSearchResultsResponse {
  @ApiProperty({
    type: String,
    nullable: false,
    example: 'layla',
    description: 'The query that was searched, trimmed.',
  })
  q!: string;

  @ApiProperty({
    type: () => AdminSearchBookingGroupResponse,
    nullable: false,
    description: 'Bookings by reference, contact name, email or phone (both roles).',
  })
  bookings!: AdminSearchBookingGroupResponse;

  @ApiProperty({
    type: () => AdminSearchCustomerGroupResponse,
    nullable: false,
    description: 'Customers by name, email or phone (both roles).',
  })
  customers!: AdminSearchCustomerGroupResponse;

  @ApiProperty({
    type: () => SearchMovieGroupResponse,
    nullable: true,
    description:
      'Admins: movies in any status (drafts and archived included) by title or cast. Null for box office, who has no Movies screen.',
  })
  movies!: SearchMovieGroupResponse | null;

  @ApiProperty({
    type: () => SearchPersonGroupResponse,
    nullable: true,
    description: 'Admins: every person, by name. Null for box office.',
  })
  people!: SearchPersonGroupResponse | null;

  @ApiProperty({
    type: () => SearchTheaterGroupResponse,
    nullable: true,
    description: 'Admins: theaters in any status, by name or district. Null for box office.',
  })
  theaters!: SearchTheaterGroupResponse | null;
}
