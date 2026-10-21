import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { formatMoneyDisplay, money } from '../../common/money/money';
import { Clock } from '../../common/time/clock';
import { formatCairoDisplay } from '../../common/time/time';
import { CatalogReadService } from '../catalog/catalog-read.service';
import { MessagingService } from '../messaging/messaging.service';
import type { QueueMessageInput } from '../messaging/types';
import { ShowtimeReadService } from '../showtimes/showtime-read.service';
import { TheaterReadService } from '../theaters/theater-read.service';
import { hasTicket } from './booking-assembly';
import { bookingStatusOf } from './booking-status.sql';
import { BookingsRepository } from './bookings.repository';
import { QrCodeService } from './qr-code.service';
import { bookingTicketsSmsTemplate } from './templates/booking-tickets-sms.template';
import { bookingTicketsTemplate } from './templates/booking-tickets.template';
import { ticketCalendar } from './ticket-calendar';
import { renderTicketPdf } from './ticket-pdf';
import type {
  BookingRow,
  BookingTicketsParams,
  QueueTicketsOptions,
  TicketAccess,
  TicketDetails,
  TicketFile,
} from './types';

/**
 * A confirmed booking's tickets (design §7.9; PRD "Tickets and QR codes", "Email and SMS"): the
 * tickets email and SMS, the PDF ticket and the calendar file, all built from the same details.
 * Exported for "Email again" (U12), counter sales and the staff download (U13) and admin resends
 * (U14).
 *
 * Every batch costs a fixed number of queries whatever its size: the bookings, their seats, their
 * showtimes, theaters and movies, then one insert per template.
 */
@Injectable()
export class TicketsService {
  constructor(
    private readonly bookings: BookingsRepository,
    private readonly showtimes: ShowtimeReadService,
    private readonly theaters: TheaterReadService,
    private readonly catalog: CatalogReadService,
    private readonly messaging: MessagingService,
    private readonly qrCodes: QrCodeService,
    private readonly clock: Clock,
  ) {}

  /**
   * Queues the tickets email of each of these confirmed bookings with an email on file, and with
   * `sms` the tickets SMS of each with a phone, in the open transaction: they leave only once it
   * commits (design §13.1). No stored copy holds the QR payload.
   */
  async queueTickets(bookingIds: readonly number[], options: QueueTicketsOptions): Promise<void> {
    const rows = (await this.bookings.findByIds(bookingIds)).filter(
      (row) => row.status === 'confirmed',
    );
    if (rows.length !== new Set(bookingIds).size) {
      throw new AppError('INTERNAL', 'Tickets are sent for confirmed bookings only.');
    }
    const details = await this.detailsOf(rows);
    const inputs = details.flatMap((ticket) => messagesOf(ticket, options));
    await this.messaging.queueMany(inputs);
  }

  /** The PDF ticket: the owner's (or staff's) confirmed or completed booking, else an error. */
  async ticketPdf(reference: string, access: TicketAccess): Promise<TicketFile> {
    const ticket = await this.ticketOf(reference, access);
    return {
      filename: `maqady-ticket-${ticket.reference}.pdf`,
      contentType: 'application/pdf',
      body: await renderTicketPdf(ticket, this.clock.now()),
    };
  }

  /** The calendar file of a ticket, as `ticketPdf()` decides access. */
  async ticketCalendar(reference: string, access: TicketAccess): Promise<TicketFile> {
    const ticket = await this.ticketOf(reference, access);
    return {
      filename: `maqady-${ticket.reference}.ics`,
      contentType: 'text/calendar; charset=utf-8',
      body: Buffer.from(ticketCalendar(ticket, this.clock.now()), 'utf8'),
    };
  }

  /**
   * The ticket of a booking. Another customer's booking, or an unknown reference, is
   * `NOT_FOUND` (never `FORBIDDEN`, design §10.4); a booking without a ticket now (held, failed,
   * abandoned, refunded) is `TICKET_NOT_AVAILABLE` with its status.
   */
  private async ticketOf(reference: string, access: TicketAccess): Promise<TicketDetails> {
    const row = await this.bookings.findByReference(reference);
    if (!row || (access.kind === 'owner' && row.customer_id !== access.customerId)) {
      throw new AppError('NOT_FOUND');
    }
    const view = (await this.showtimes.findByIds([row.showtime_id])).get(row.showtime_id);
    if (!view) {
      throw new AppError('INTERNAL', 'A booking references a showtime that does not exist.');
    }
    const status = bookingStatusOf(
      {
        status: row.status,
        holdExpiresAt: row.hold_expires_at,
        hasDeclinedPayment: row.has_declined_payment,
        showtimeEndsAt: view.endsAt,
      },
      this.clock.now(),
    );
    if (!hasTicket(status)) throw new AppError('TICKET_NOT_AVAILABLE', undefined, { status });
    const [details] = await this.detailsOf([row]);
    if (!details) throw new AppError('INTERNAL', 'A ticket could not be assembled.');
    return details;
  }

  /** The ticket details of these bookings with a QR version, in their order. */
  private async detailsOf(rows: readonly BookingRow[]): Promise<TicketDetails[]> {
    if (rows.length === 0) return [];
    // One after the other: inside a transaction they would share one connection.
    const seats = await this.bookings.seatsOf(rows.map((row) => row.id));
    const showtimes = await this.showtimes.findByIds(rows.map((row) => row.showtime_id));
    const views = [...showtimes.values()];
    const theaters = await this.theaters.findByIds(views.map((view) => view.theaterId));
    const movies = await this.catalog.findMoviesByIds(views.map((view) => view.movieId));
    return rows.map((row) => {
      const view = showtimes.get(row.showtime_id);
      const theater = view && theaters.get(view.theaterId);
      const movie = view && movies.get(view.movieId);
      if (!view || !theater || !movie || row.qr_version === null) {
        throw new AppError('INTERNAL', 'A ticket references data that does not exist.');
      }
      const own = seats.filter((seat) => seat.booking_id === row.id);
      return {
        bookingId: row.id,
        reference: row.reference,
        customerId: row.customer_id,
        contactName: row.contact_name,
        contactEmail: row.contact_email,
        contactPhone: row.contact_phone,
        movieTitle: movie.title,
        ageRating: movie.ageRating,
        theaterName: theater.name,
        theaterAddress: theater.address,
        theaterDistrict: theater.district,
        theaterCity: theater.city,
        hallName: view.hallName,
        startsAt: view.startsAt,
        endsAt: view.endsAt,
        cinemaDate: view.cinemaDate,
        seats: own.map((seat) => ({ label: seat.seat_label, zone: seat.zone })),
        admits: row.seat_count,
        total: money(row.total_amount, row.currency),
        qrCode: this.qrCodes.payloadFor(row.reference, row.qr_version),
      };
    });
  }
}

/** The tickets email (with an email on file) and SMS (asked for, with a phone) of one booking. */
function messagesOf(
  ticket: TicketDetails,
  options: QueueTicketsOptions,
): QueueMessageInput<BookingTicketsParams>[] {
  const params: BookingTicketsParams = {
    reference: ticket.reference,
    customerName: ticket.contactName,
    movieTitle: ticket.movieTitle,
    ageRating: ticket.ageRating,
    theaterName: ticket.theaterName,
    theaterAddress: `${ticket.theaterAddress}, ${ticket.theaterDistrict}, ${ticket.theaterCity}`,
    hallName: ticket.hallName,
    startsAt: formatCairoDisplay(ticket.startsAt),
    seats: ticket.seats.map((seat) => seat.label).join(', '),
    admits: ticket.admits,
    total: formatMoneyDisplay(ticket.total),
    qrCode: ticket.qrCode,
  };
  const related = {
    bookingId: ticket.bookingId,
    ...(ticket.customerId === null ? {} : { customerId: ticket.customerId }),
  };
  return [
    ...(ticket.contactEmail === null
      ? []
      : [{ template: bookingTicketsTemplate, recipient: ticket.contactEmail, params, related }]),
    ...(options.sms && ticket.contactPhone !== null
      ? [{ template: bookingTicketsSmsTemplate, recipient: ticket.contactPhone, params, related }]
      : []),
  ];
}
