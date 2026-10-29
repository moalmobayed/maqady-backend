import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Admin, CurrentPrincipal, Staff } from '../../common/auth/access.decorators';
import type { StaffPrincipal } from '../../common/auth/types';
import { Strict } from '../../common/idempotency/idempotency.decorators';
import { PageQuery } from '../../common/pagination/dto/page-query.dto';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { AdminBookingResponseMapper } from './admin-booking-response.mapper';
import { AdminBookingsService } from './admin-bookings.service';
import { BookingEditsService } from './booking-edits.service';
import { BookingNotesService } from './booking-notes.service';
import { BookingRefundsService } from './booking-refunds.service';
import { AdminBookingResponse } from './dto/admin-booking.response';
import { AdminBookingListItemPageResponse } from './dto/admin-booking-list-item.response';
import { AdminBookingSummaryResponse } from './dto/admin-booking-summary.response';
import { AdminBookingsQuery } from './dto/admin-bookings.query';
import { BookingEditPreviewResponse, BookingEditResultResponse } from './dto/booking-edit.response';
import { CreateBookingNoteRequest } from './dto/booking-note.request';
import { BookingNotePageResponse, BookingNoteResponse } from './dto/booking-note.response';
import { BookingRefParams } from './dto/booking-ref.params';
import { BookingRefundResultResponse } from './dto/booking-refund-result.response';
import { EditBookingRequest } from './dto/edit-booking.request';
import { StaffTicketDeliveryResponse } from './dto/staff-ticket-delivery.response';
import { SettleFirst } from './settle-first.decorator';
import { StaffTicketDeliveryService } from './staff-ticket-delivery.service';
import type { AdminBookingFilter, EditBookingInput } from './types';

/**
 * The admin Bookings page (PRD A6; design §7.7, §7.8, §11): the list with search and filters,
 * the four summary cards, a booking's detail, internal notes and "Resend tickets" for both staff
 * roles; "Cancel & refund" and "Edit booking" for admins only (PRD call 13).
 */
@ApiTags('Admin: bookings')
@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(
    private readonly admin: AdminBookingsService,
    private readonly notes: BookingNotesService,
    private readonly deliveries: StaffTicketDeliveryService,
    private readonly refunds: BookingRefundsService,
    private readonly edits: BookingEditsService,
    private readonly mapper: AdminBookingResponseMapper,
  ) {}

  @Get()
  @Staff()
  @ApiOperation({
    summary: 'List bookings',
    description:
      "Staff (box office or admin): the Bookings table (PRD A6), newest first, cursor-paged, with `total` under the same filters. Due slow payments are settled first, so nothing shows a stale `processing`.\n\n- `q` searches a booking reference exactly (any case), else part of the contact name, email or phone (case-insensitive; a local Egyptian mobile such as `01012345678` also finds `+201012345678`).\n- Filters combine: `theaterId`, `movieId`, `status` (decided now from stored times), `channel`, `method` (a sale payment of that method), `dateFrom` / `dateTo` (cinema dates the booking was made on, inclusive), `customerId` (one customer's bookings, the Customers drawer).\n- Each row carries the contact, the showtime header, the seats, the total, the latest payment and the check-in.",
  })
  @ApiOkResponse({
    type: AdminBookingListItemPageResponse,
    description: 'One page of bookings',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'SERVICE_UNAVAILABLE')
  async listAdminBookings(
    @Query() query: AdminBookingsQuery,
  ): Promise<InstanceType<typeof AdminBookingListItemPageResponse>> {
    return this.mapper.listPage(
      await this.admin.list(filterOf(query), { cursor: query.cursor, limit: query.limit }),
    );
  }

  @Get('summary')
  @Staff()
  @ApiOperation({
    summary: 'The four summary cards',
    description:
      "Staff: the cards above the Bookings table (PRD A6), for today's cinema day (06:00 to 06:00 Cairo time): bookings made today that were paid, the money collected today (taken minus refunds paid out, on the day the money moved), online payments declined today, and the bookings refunded in the last 7 days with what they got back. Due slow payments are settled first. Filter the table to today with `dateFrom` and `dateTo` set to `cinemaDate`.",
  })
  @ApiOkResponse({
    type: AdminBookingSummaryResponse,
    description: 'The four cards',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('SERVICE_UNAVAILABLE')
  async getAdminBookingSummary(): Promise<AdminBookingSummaryResponse> {
    return this.mapper.summary(await this.admin.summary());
  }

  @Get(':ref')
  @Staff()
  @SettleFirst('booking')
  @ApiOperation({
    summary: 'Get a booking',
    description:
      'Staff: the booking detail (PRD A6): every `Booking` field (seat lines and total, the latest payment, the ticket with its QR code while confirmed or completed, the refund), plus the contact, the customer card, the counter seller, the check-in, every payment and refund with its rail and status (`payments`), what "Cancel & refund" would give back (`refundable`), which actions apply now (`actions`) and the activity log (the first 100 events, oldest first, with who acted). Internal notes: `GET /admin/bookings/{ref}/notes`. An unknown reference: `NOT_FOUND`.',
  })
  @ApiOkResponse({
    type: AdminBookingResponse,
    description: 'The booking',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'SERVICE_UNAVAILABLE')
  async getAdminBooking(@Param() params: BookingRefParams): Promise<AdminBookingResponse> {
    return this.mapper.detail(await this.admin.detail(params.ref));
  }

  @Get(':ref/notes')
  @Staff()
  @ApiOperation({
    summary: "List a booking's internal notes",
    description:
      'Staff (box office or admin): the "Internal notes" panel of the booking detail (PRD A6), newest first, each with its text, its author and when it was written, cursor-paged with `total`. Notes are for staff only: no customer route, message or export ever shows them, and the activity log records only that a note was added. An unknown reference: `NOT_FOUND`.',
  })
  @ApiOkResponse({
    type: BookingNotePageResponse,
    description: 'One page of notes',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async listBookingNotes(
    @Param() params: BookingRefParams,
    @Query() query: PageQuery,
  ): Promise<InstanceType<typeof BookingNotePageResponse>> {
    return this.mapper.notePage(
      await this.notes.list(params.ref, { cursor: query.cursor, limit: query.limit }),
    );
  }

  @Post(':ref/notes')
  @Staff()
  @Strict()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Add an internal note',
    description:
      '"Add a note for staff" (PRD A6), both roles. Requires an `Idempotency-Key`. 1 to 1,000 characters; the author and time are recorded. Customers never see notes, and the activity log records only that a note was added, never its text. An unknown reference: `NOT_FOUND`.',
  })
  @ApiBody({ type: CreateBookingNoteRequest })
  @ApiCreatedResponse({
    type: BookingNoteResponse,
    description: 'The note',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async addBookingNote(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: BookingRefParams,
    @Body() body: CreateBookingNoteRequest,
  ): Promise<BookingNoteResponse> {
    return this.mapper.note(await this.notes.add(principal, params.ref, body.body));
  }

  @Post(':ref/ticket-deliveries')
  @Staff()
  @Strict()
  @SettleFirst('booking')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Resend the tickets',
    description:
      '"Resend tickets" (PRD A6, "Email and SMS"), both roles. Requires an `Idempotency-Key`: the same key replays the first answer and sends nothing more. Queues the tickets email to the booking\'s contact email and the tickets SMS to its contact phone, each when on file, with the current QR code. Recorded in the activity log and in the customer\'s History as "Tickets resent".\n\n- A booking without a ticket (held, failed, abandoned, refunded): `TICKET_NOT_AVAILABLE` with `details.status`.\n- No email and no phone on the booking (a walk-in): `NO_CONTACT_DETAILS`; download the PDF instead.\n- An unknown reference: `NOT_FOUND`.',
  })
  @ApiCreatedResponse({
    type: StaffTicketDeliveryResponse,
    description: 'The tickets are queued',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses(
    'VALIDATION_FAILED',
    'NOT_FOUND',
    'TICKET_NOT_AVAILABLE',
    'NO_CONTACT_DETAILS',
    'SERVICE_UNAVAILABLE',
  )
  async resendBookingTickets(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: BookingRefParams,
  ): Promise<StaffTicketDeliveryResponse> {
    return this.mapper.delivery(await this.deliveries.resend(principal, params.ref));
  }

  @Post(':ref/refunds')
  @Admin()
  @Strict()
  @SettleFirst('booking')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Cancel and refund a booking',
    description:
      '"Cancel & refund" (PRD A6, "Cancellations" 2–3), admins only: always the full amount. Requires an `Idempotency-Key`: the same key replays the first answer; a second request (or two admins at once) finds the booking refunded and changes nothing, so every charge is refunded exactly once.\n\n- Only a `confirmed` booking whose showtime has not ended (a projector can fail mid-show): otherwise `BOOKING_NOT_REFUNDABLE` with `details.status`.\n- Every charge is refunded for what is left of it, on its own rail: card and wallet through the payment provider at once (`succeeded`), cash and card terminal as a `pending` refund to hand back at the counter, then recorded with `POST /admin/refunds/{id}/payouts`.\n- The booking becomes `refunded`, its seats are released at once (`seat.released` on the seat map) and its QR code stops admitting anyone. The refund notice is emailed to the contact email.\n- Recorded in the activity log and the customer\'s History ("Refunded").',
  })
  @ApiCreatedResponse({
    type: BookingRefundResultResponse,
    description: 'The refunds and the refunded booking',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses(
    'VALIDATION_FAILED',
    'NOT_FOUND',
    'BOOKING_NOT_REFUNDABLE',
    'SERVICE_UNAVAILABLE',
  )
  async cancelAndRefundBooking(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: BookingRefParams,
  ): Promise<BookingRefundResultResponse> {
    return this.mapper.refundResult(await this.refunds.cancelAndRefund(principal, params.ref));
  }

  @Post(':ref/edit-previews')
  @Admin()
  @SettleFirst('booking')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Preview a booking edit',
    description:
      'Admins only: the "before/after diff" of "Edit booking" (PRD A6), with the same body as `POST /admin/bookings/{ref}/edits`. Saves nothing and locks nothing (an `Idempotency-Key` is optional), so call it as the admin changes the form. It runs every check the edit runs except `payment`, and computes the new seats and prices, the new total and the difference exactly as the edit will: seats kept on the same showtime keep their sold price, others take the showtime\'s current zone prices; a lower total is split across the charges newest first (`refunds`). `unavailableSeats` lists the proposed seats someone else holds right now. Refusals are the edit\'s: `BOOKING_NOT_EDITABLE`, `SHOWTIME_NOT_BOOKABLE`, `VALIDATION_FAILED`, `NOT_FOUND`.',
  })
  @ApiBody({ type: EditBookingRequest })
  @ApiOkResponse({
    type: BookingEditPreviewResponse,
    description: 'The edit as it would be applied now',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses(
    'VALIDATION_FAILED',
    'NOT_FOUND',
    'BOOKING_NOT_EDITABLE',
    'SHOWTIME_NOT_BOOKABLE',
    'SERVICE_UNAVAILABLE',
  )
  async previewBookingEdit(
    @Param() params: BookingRefParams,
    @Body() body: EditBookingRequest,
  ): Promise<BookingEditPreviewResponse> {
    return this.mapper.editPreview(await this.edits.preview(params.ref, editOf(body)));
  }

  @Post(':ref/edits')
  @Admin()
  @Strict()
  @SettleFirst('booking')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Edit a booking',
    description:
      '"Edit booking" (PRD A6, "Cancellations, refunds and edits" 5–6), admins only: another showtime of the same movie, other seats, or other contact details, with a required `reason`. Requires an `Idempotency-Key`. Applied in one transaction: preview it first with `POST /admin/bookings/{ref}/edit-previews`.\n\n- Only a `confirmed` booking whose showtime has not started and that nobody has checked in: otherwise `BOOKING_NOT_EDITABLE` with `details.reason` (`not_confirmed`, `started`, `checked_in`). Completed, refunded, failed and abandoned bookings are never edited.\n- When the showtime or seats change, the target showtime must be bookable now (`SHOWTIME_NOT_BOOKABLE` with `details.reason`) and of the same movie; every seat must be in its hall (`VALIDATION_FAILED` on `seats.<index>`). A seat someone else holds or bought: `SEAT_TAKEN` with `details.seats`, and nothing changes.\n- A lower total is refunded automatically, across the charges newest first, each on its own rail (card and wallet through the provider; cash and card terminal pending, to pay out). A higher total is taken at the counter in the same request: `payment` is required then and refused otherwise.\n- The booking gets a new QR code; the old one stops working. With `notify: true` the new tickets are emailed and texted to the contact. The old seats are released and the new ones booked on the seat map.\n- An edit that changes nothing: `VALIDATION_FAILED`. Another edit saved meanwhile: `CONFLICT`; read the booking again.\n- Recorded in the activity log with the reason and the changed field names, and in the customer\'s History ("Changed by the cinema").',
  })
  @ApiBody({ type: EditBookingRequest })
  @ApiCreatedResponse({
    type: BookingEditResultResponse,
    description: 'The edited booking and the money it moved',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses(
    'VALIDATION_FAILED',
    'NOT_FOUND',
    'BOOKING_NOT_EDITABLE',
    'SHOWTIME_NOT_BOOKABLE',
    'SEAT_TAKEN',
    'CONFLICT',
    'SERVICE_UNAVAILABLE',
  )
  async editBooking(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: BookingRefParams,
    @Body() body: EditBookingRequest,
  ): Promise<BookingEditResultResponse> {
    return this.mapper.editResult(await this.edits.apply(principal, params.ref, editOf(body)));
  }
}

/** The validated query's filters, as the service takes them. */
function filterOf(query: AdminBookingsQuery): AdminBookingFilter {
  return {
    ...(query.q !== undefined ? { q: query.q } : {}),
    ...(query.theaterId !== undefined ? { theaterId: query.theaterId } : {}),
    ...(query.movieId !== undefined ? { movieId: query.movieId } : {}),
    ...(query.status !== undefined ? { status: query.status } : {}),
    ...(query.channel !== undefined ? { channel: query.channel } : {}),
    ...(query.method !== undefined ? { method: query.method } : {}),
    ...(query.dateFrom !== undefined ? { dateFrom: query.dateFrom } : {}),
    ...(query.dateTo !== undefined ? { dateTo: query.dateTo } : {}),
    ...(query.customerId !== undefined ? { customerId: query.customerId } : {}),
  };
}

/** The validated edit, as the service takes it. */
function editOf(body: EditBookingRequest): EditBookingInput {
  const contact = body.contact;
  return {
    ...(body.showtimeId !== undefined ? { showtimeId: body.showtimeId } : {}),
    ...(body.seats !== undefined ? { seats: body.seats } : {}),
    ...(contact !== undefined
      ? {
          contact: {
            ...(contact.name !== undefined ? { name: contact.name } : {}),
            ...(contact.email !== undefined ? { email: contact.email } : {}),
            ...(contact.phone !== undefined ? { phone: contact.phone } : {}),
          },
        }
      : {}),
    reason: body.reason,
    notify: body.notify ?? false,
    ...(body.payment !== undefined
      ? {
          payment: {
            method: body.payment.method,
            receiptReference:
              body.payment.method === 'card_terminal'
                ? (body.payment.receiptReference ?? null)
                : null,
          },
        }
      : {}),
  };
}
