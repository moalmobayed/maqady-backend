import { Controller, Get, Header, Param, StreamableFile } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, Customer } from '../../common/auth/access.decorators';
import type { CustomerPrincipal } from '../../common/auth/types';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { TICKET_CACHE_CONTROL } from './bookings.constants';
import { BookingRefParams } from './dto/booking-ref.params';
import { SettleFirst } from './settle-first.decorator';
import { TicketsService } from './tickets.service';
import type { TicketFile } from './types';

const ACCESS_NOTE =
  "The signed-in customer who owns the booking, while it is `confirmed` or `completed`. Fetch it with the `Authorization` header and save the file: no token ever goes in a URL. Built on demand, never cached (`Cache-Control: private, no-store`). A booking without a ticket (held, failed, abandoned, refunded): `TICKET_NOT_AVAILABLE` with `details.status`. Someone else's booking or an unknown reference: `NOT_FOUND`.";

/** The ticket downloads (design §7.9; PRD C9, C11 "Download ticket", "Add to calendar"). */
@ApiTags('Tickets')
@Controller('bookings')
export class BookingTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get(':ref/ticket.pdf')
  @Customer()
  @SettleFirst('booking')
  @Header('Cache-Control', TICKET_CACHE_CONTROL)
  @ApiOperation({
    summary: 'Download the PDF ticket',
    description: `${ACCESS_NOTE}\n\nAn A5 page with the movie and its age rating, the theater and its address, the hall, the date and time, the seats with their zones, "Admits n", the booking reference and the QR code, saved as \`maqady-ticket-<reference>.pdf\`.`,
  })
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    description: 'The PDF ticket (`Content-Disposition: attachment`)',
    schema: { type: 'string', format: 'binary' },
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'TICKET_NOT_AVAILABLE')
  async downloadTicket(
    @CurrentPrincipal() principal: CustomerPrincipal,
    @Param() params: BookingRefParams,
  ): Promise<StreamableFile> {
    return download(
      await this.tickets.ticketPdf(params.ref, { kind: 'owner', customerId: principal.id }),
    );
  }

  @Get(':ref/calendar.ics')
  @Customer()
  @SettleFirst('booking')
  @Header('Cache-Control', TICKET_CACHE_CONTROL)
  @ApiOperation({
    summary: 'Add to calendar (.ics)',
    description: `${ACCESS_NOTE}\n\nAn iCalendar file (RFC 5545) with one event: the movie and theater, the showtime's start and end (in UTC, so every calendar shows its own time zone), the theater's address as the location, and the reference, hall and seats. Saved as \`maqady-<reference>.ics\`.`,
  })
  @ApiProduces('text/calendar')
  @ApiOkResponse({
    description: 'The calendar file (`Content-Disposition: attachment`)',
    schema: { type: 'string', example: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n…' },
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'TICKET_NOT_AVAILABLE')
  async downloadCalendar(
    @CurrentPrincipal() principal: CustomerPrincipal,
    @Param() params: BookingRefParams,
  ): Promise<StreamableFile> {
    return download(
      await this.tickets.ticketCalendar(params.ref, { kind: 'owner', customerId: principal.id }),
    );
  }
}

function download(file: TicketFile): StreamableFile {
  return new StreamableFile(file.body, {
    type: file.contentType,
    disposition: `attachment; filename="${file.filename}"`,
    length: file.body.length,
  });
}
