import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentPrincipal, Staff } from '../../common/auth/access.decorators';
import type { StaffPrincipal } from '../../common/auth/types';
import { Strict } from '../../common/idempotency/idempotency.decorators';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { BookingResponseMapper } from './booking-response.mapper';
import { HOLD_MINUTES, MAX_SEATS_PER_HOLD, TICKET_CACHE_CONTROL } from './bookings.constants';
import { CounterSalesService } from './counter-sales.service';
import { BookingRefParams } from './dto/booking-ref.params';
import { BookingResponse } from './dto/booking.response';
import { CreateCounterHoldRequest } from './dto/create-counter-hold.request';
import {
  type CounterCustomerRequest,
  CreateCounterPaymentRequest,
} from './dto/create-counter-payment.request';
import { PaymentResultResponse } from './dto/payment-result.response';
import { SettleFirst } from './settle-first.decorator';
import { StaffTicketsService } from './staff-tickets.service';
import type { CounterCustomer } from './types';

/**
 * The box office (design §7.6, §7.9, §11; PRD A6 "New booking", Payments 2): counter holds and
 * counter sales paid on the spot, and the staff ticket download. Both staff roles.
 */
@ApiTags('Admin: box office')
@Controller('admin')
export class BoxOfficeController {
  constructor(
    private readonly counter: CounterSalesService,
    private readonly tickets: StaffTicketsService,
    private readonly mapper: BookingResponseMapper,
  ) {}

  @Post('counter-holds')
  @Staff()
  @Strict()
  @SettleFirst('showtime', 'body')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Hold seats for a counter sale',
    description: `Staff (box office or admin): step one of "New booking" at the counter. Requires an \`Idempotency-Key\`.\n\n- Holds 1 to ${MAX_SEATS_PER_HOLD} seats picked on the live map for ${HOLD_MINUTES} minutes (or until the showtime starts, if sooner), priced from each row's zone now, exactly like an online hold: the same bookability checks, the same seat claims and the same lock order, so a seat is never sold twice across the website and the counter. The seats disappear from the online map at once (\`seat.held\`).\n- The hold is the signed-in member's own: a member has at most one live counter hold, so a new one releases the previous one (its seats are announced free). Customers' and other members' holds are never touched.\n- The booking has \`channel: counter\` and \`owner: staff\`, no customer and no hold code. Take the money next with \`POST /admin/bookings/{ref}/counter-payments\`; a hold that lapses reads as \`abandoned\`.\n- A seat someone else holds or bought: \`SEAT_TAKEN\` with \`details.seats\` (nothing changes, the previous hold stays). \`SHOWTIME_NOT_BOOKABLE\` with \`details.reason\`: \`cancelled\`, \`started\`, \`sales_paused\`, \`movie_unavailable\` or \`hall_unavailable\`. An unknown showtime, or one of a draft theater: \`NOT_FOUND\`. A seat not in the hall: \`VALIDATION_FAILED\` on \`seats.<index>\`.\n- Recorded in the activity log and the booking's history.`,
  })
  @ApiBody({ type: CreateCounterHoldRequest })
  @ApiCreatedResponse({
    type: BookingResponse,
    description: 'The counter hold',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'SHOWTIME_NOT_BOOKABLE', 'SEAT_TAKEN')
  async createCounterHold(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Body() body: CreateCounterHoldRequest,
  ): Promise<BookingResponse> {
    return this.mapper.booking(
      await this.counter.createHold(principal, {
        showtimeId: body.showtimeId,
        labels: body.seats,
      }),
    );
  }

  @Delete('counter-holds/:ref')
  @Staff()
  @SettleFirst('booking')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Release your counter hold',
    description:
      'Staff: the member who made the counter hold ("Cancel" on the New booking screen). An `Idempotency-Key` is optional. The seats are free at once (announced on the seat map) and the booking reads as `abandoned`. A hold that already ended answers `204` and changes nothing. A paid booking: `ALREADY_PAID` (refunds are an admin action). Another member\'s counter hold: `FORBIDDEN` with `details.reason: not_your_counter_hold`. An online booking or an unknown reference: `NOT_FOUND`. Recorded in the activity log.',
  })
  @ApiNoContentResponse({ description: 'Released', headers: REQUEST_ID_RESPONSE_HEADER })
  @ApiErrorResponses('VALIDATION_FAILED', 'FORBIDDEN', 'NOT_FOUND', 'ALREADY_PAID')
  async releaseCounterHold(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: BookingRefParams,
  ): Promise<void> {
    await this.counter.releaseHold(principal, params.ref);
  }

  @Post('bookings/:ref/counter-payments')
  @Staff()
  @Strict()
  @SettleFirst('booking')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Take payment for a counter hold',
    description:
      "Staff: the member who made the counter hold records the money taken on the spot and who the sale is for, step two of \"New booking\". Requires an `Idempotency-Key`: the same key replays the first answer, so a double press never records two payments.\n\n- `cash`, or `card_terminal` with the terminal's `receiptReference` (terminals are not connected). The amount is the hold's own total. The payment is recorded as `succeeded` at once (counter payments are never Processing or Declined), with the member as the collector.\n- `customer`: `walk_in` (nobody on file), `existing` (a customer account: the booking becomes theirs and shows in their My Bookings) or `contact` (typed name, optional email and phone).\n- In the same transaction the booking is `confirmed`, its seats are sold (`seat.booked` on the seat map) and the tickets go out: the email to any email on file, the SMS to any phone. Download the PDF for a walk-in with `GET /admin/bookings/{ref}/ticket.pdf`. `booking.ticket` holds the QR payload.\n- `HOLD_EXPIRED`: the hold ended (at `holdExpiresAt` exactly, too) or lost a seat; nothing was recorded, pick seats again. `SHOWTIME_NOT_BOOKABLE` with `details.reason`: the showtime started or was cancelled, the theater paused sales, the movie or hall is no longer available. `ALREADY_PAID`: the booking is already confirmed or refunded. Another member's counter hold: `FORBIDDEN` with `details.reason: not_your_counter_hold`. An online booking or an unknown reference: `NOT_FOUND`. An unknown, anonymised or blocked customer account: `VALIDATION_FAILED` on `customer.customerId`.\n- Recorded in the activity log and the booking's history (never the customer's details).",
  })
  @ApiBody({ type: CreateCounterPaymentRequest })
  @ApiCreatedResponse({
    type: PaymentResultResponse,
    description: 'The counter payment and the confirmed booking',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses(
    'VALIDATION_FAILED',
    'FORBIDDEN',
    'NOT_FOUND',
    'SHOWTIME_NOT_BOOKABLE',
    'HOLD_EXPIRED',
    'ALREADY_PAID',
  )
  async createCounterPayment(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: BookingRefParams,
    @Body() body: CreateCounterPaymentRequest,
  ): Promise<PaymentResultResponse> {
    return this.mapper.paymentResult(
      await this.counter.pay(principal, params.ref, {
        method: body.method,
        receiptReference: body.method === 'card_terminal' ? (body.receiptReference ?? null) : null,
        customer: counterCustomerOf(body.customer),
      }),
    );
  }

  @Get('bookings/:ref/ticket.pdf')
  @Staff()
  @SettleFirst('booking')
  @Header('Cache-Control', TICKET_CACHE_CONTROL)
  @ApiOperation({
    summary: 'Download a booking’s PDF ticket',
    description:
      'Staff (box office or admin): the PDF ticket of any booking while it is `confirmed` or `completed`, online or at the counter, for a walk-in with no email or a customer at the counter who asks for it (PRD "Tickets and QR codes"). The same A5 ticket the customer downloads: movie and age rating, theater and address, hall, date and time, seats with zones, "Admits n", the reference and the QR code, saved as `maqady-ticket-<reference>.pdf`. Fetch it with the `Authorization` header and save the file: no token ever goes in a URL. Built on demand, never cached (`Cache-Control: private, no-store`). A booking without a ticket (held, failed, abandoned, refunded): `TICKET_NOT_AVAILABLE` with `details.status`. An unknown reference: `NOT_FOUND`. Each download is recorded in the activity log, since the PDF carries a working QR code.',
  })
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    description: 'The PDF ticket (`Content-Disposition: attachment`)',
    schema: { type: 'string', format: 'binary' },
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'TICKET_NOT_AVAILABLE')
  async downloadStaffTicket(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: BookingRefParams,
  ): Promise<StreamableFile> {
    const file = await this.tickets.ticketPdf(principal, params.ref);
    return new StreamableFile(file.body, {
      type: file.contentType,
      disposition: `attachment; filename="${file.filename}"`,
      length: file.body.length,
    });
  }
}

/** The validated request's customer, as the service takes it. */
function counterCustomerOf(customer: CounterCustomerRequest): CounterCustomer {
  switch (customer.kind) {
    case 'walk_in':
      return { kind: 'walk_in' };
    case 'existing':
      return { kind: 'existing', customerId: customer.customerId! };
    case 'contact':
      return {
        kind: 'contact',
        fullName: customer.fullName!,
        email: customer.email ?? null,
        phone: customer.phone ?? null,
      };
  }
}
