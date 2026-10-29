import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Admin, CurrentPrincipal, Staff } from '../../common/auth/access.decorators';
import type { StaffPrincipal } from '../../common/auth/types';
import { NoIdempotencyStorage, Strict } from '../../common/idempotency/idempotency.decorators';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { AdminCustomerResponseMapper } from './admin-customer-response.mapper';
import { AdminCustomersService } from './admin-customers.service';
import { CustomerAnonymisationService } from './customer-anonymisation.service';
import {
  AdminCustomerDetailResponse,
  AdminCustomerPageResponse,
  AdminCustomerResponse,
} from './dto/admin-customer.response';
import { AdminCustomersQuery } from './dto/admin-customers.query';
import { CustomerAnonymisationResponse } from './dto/customer-anonymisation.response';
import { CustomerIdParams } from './dto/customer-id.params';
import { CustomerPasswordResetResponse } from './dto/customer-password-reset.response';
import { UpdateCustomerRequest } from './dto/update-customer.request';

/**
 * The admin Customers page (PRD A7; design §11): the list and a customer's drawer for both staff
 * roles; edit details, Block or Unblock, "Send password reset email" and "Delete account" for
 * admins only (PRD call 13). Box office sees the same data read-only.
 */
@ApiTags('Admin: customers')
@Controller('admin/customers')
export class AdminCustomersController {
  constructor(
    private readonly customers: AdminCustomersService,
    private readonly anonymisation: CustomerAnonymisationService,
    private readonly mapper: AdminCustomerResponseMapper,
  ) {}

  @Get()
  @Staff()
  @ApiOperation({
    summary: 'List customers',
    description:
      'Staff (box office or admin): the Customers table (PRD A7), newest account first, cursor-paged, with `total` under the same filters. Deleted (anonymised) accounts are never listed. Due slow payments are settled first, so the numbers match the Bookings screen.\n\n- `q` matches part of the name, email or phone, case-insensitively (a local Egyptian mobile such as `01012345678` also finds `+201012345678`).\n- `status` keeps only `active` or only `blocked` customers.\n- Each row carries `stats`: Bookings (paid and not refunded), Spent, No-shows (shows that ended, never scanned) and Last booking.',
  })
  @ApiOkResponse({
    type: AdminCustomerPageResponse,
    description: 'One page of customers',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'SERVICE_UNAVAILABLE')
  async listAdminCustomers(
    @Query() query: AdminCustomersQuery,
  ): Promise<InstanceType<typeof AdminCustomerPageResponse>> {
    return this.mapper.page(
      await this.customers.list(
        {
          ...(query.q !== undefined ? { q: query.q } : {}),
          ...(query.status !== undefined ? { status: query.status } : {}),
        },
        { cursor: query.cursor, limit: query.limit },
      ),
    );
  }

  @Get(':id')
  @Staff()
  @ApiOperation({
    summary: "A customer's drawer",
    description:
      'Staff (box office or admin): the customer drawer (PRD A7): the details, the Bookings, Spent and No-shows stats, and "Recent bookings" (the 4 newest, any status, as the Bookings table shows them; all of them with `GET /admin/bookings?customerId=`). Box office sees it read-only.\n\n- A deleted (anonymised) or unknown customer is `NOT_FOUND`; the booking detail\'s customer card says `anonymised: true` for those.\n- Due slow payments are settled first.',
  })
  @ApiOkResponse({
    type: AdminCustomerDetailResponse,
    description: 'The customer',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'SERVICE_UNAVAILABLE')
  async getAdminCustomer(@Param() params: CustomerIdParams): Promise<AdminCustomerDetailResponse> {
    return this.mapper.detail(await this.customers.detail(params.id));
  }

  @Patch(':id')
  @Admin()
  // The answer carries the customer's name, email and phone, so it is never stored: a stored copy
  // would outlive "Delete account" and replay them (U15 review). Sending the same edit again is
  // harmless: equal values change nothing.
  @NoIdempotencyStorage()
  @ApiOperation({
    summary: 'Edit a customer, block or unblock them',
    description:
      'Admin only: "Save details", Block and Unblock in the drawer (PRD A7, Accounts 5). Send any of `fullName`, `email`, `phone` (`null` removes it) and `status`; fields not sent stay, and values equal to the stored ones change nothing. All of it applies together or not at all.\n\n- A new email must not belong to another live account (`EMAIL_TAKEN`). It is unverified from then on, and the customer\'s unused verification and reset links stop working.\n- `status: blocked` signs the customer out everywhere at once (their next request is `401`), and their sign-in and refresh answer `ACCOUNT_BLOCKED`; paid tickets stay valid. `status: active` unblocks: they sign in and book again right away.\n- Bookings keep the contact they were made with; edit a booking\'s contact on the booking.\n- A deleted (anonymised) or unknown customer is `NOT_FOUND`.\n- Recorded in the activity log with the names of the changed fields, never their values.\n- Answers the customer with their stats (without `recentBookings`, which an edit does not change). The answer is never stored for replay (it carries personal data that Delete account removes); an `Idempotency-Key` is ignored, and sending the same edit again changes nothing.',
  })
  @ApiBody({ type: UpdateCustomerRequest })
  @ApiOkResponse({
    type: AdminCustomerResponse,
    description: 'The customer after the change',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'EMAIL_TAKEN', 'SERVICE_UNAVAILABLE')
  async updateAdminCustomer(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: CustomerIdParams,
    @Body() body: UpdateCustomerRequest,
  ): Promise<AdminCustomerResponse> {
    return this.mapper.item(
      await this.customers.update({ kind: 'staff', id: principal.id }, params.id, {
        ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      }),
    );
  }

  @Delete(':id')
  @Admin()
  @ApiOperation({
    summary: 'Delete (anonymise) a customer',
    description:
      'Admin only: "Delete account" (PRD Accounts 6, A7). The customer is anonymised in one transaction, never hard-deleted:\n\n- their name, email, phone and password are removed, and the account is marked deleted: it disappears from the list, its sign-in and tokens stop working, and the email can register again;\n- the name, email and phone copied onto their bookings are cleared;\n- their sessions, verification and reset links, stored request results and messages are deleted, and so are the internal notes on their bookings;\n- their bookings and payments stay for accounting (`bookingsKept`), with their seats and totals; a paid ticket stays valid.\n\nA deleted or unknown customer is `NOT_FOUND`, so a repeated delete answers `NOT_FOUND`. Recorded in the activity log with the counts only.',
  })
  @ApiOkResponse({
    type: CustomerAnonymisationResponse,
    description: 'The customer was anonymised',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'SERVICE_UNAVAILABLE')
  async anonymiseAdminCustomer(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: CustomerIdParams,
  ): Promise<CustomerAnonymisationResponse> {
    return this.mapper.anonymisation(
      await this.anonymisation.anonymise({ kind: 'staff', id: principal.id }, params.id),
    );
  }

  @Post(':id/password-reset-requests')
  @Admin()
  @Strict()
  @HttpCode(202)
  @ApiOperation({
    summary: 'Send the customer a password reset email',
    description:
      'Admin only: "Send password reset email" in the drawer (PRD "Email and SMS": admin sends a reset). Emails the account email a link to `/reset-password` that works once, for 1 hour; an earlier unused reset link stops working. The link is only in the email: the response and the Message log never show it.\n\n- A blocked customer is `CUSTOMER_BLOCKED` and nothing is sent (the link would be refused); unblock first.\n- A deleted (anonymised) or unknown customer is `NOT_FOUND`.\n- Requires `Idempotency-Key`: a retry with the same key sends no second email.\n- Recorded in the activity log.',
  })
  @ApiAcceptedResponse({
    type: CustomerPasswordResetResponse,
    description: 'The reset email is queued',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'CUSTOMER_BLOCKED', 'SERVICE_UNAVAILABLE')
  async requestAdminCustomerPasswordReset(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: CustomerIdParams,
  ): Promise<CustomerPasswordResetResponse> {
    return this.mapper.passwordReset(
      await this.customers.sendPasswordReset({ kind: 'staff', id: principal.id }, params.id),
    );
  }
}
