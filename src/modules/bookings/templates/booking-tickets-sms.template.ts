import type { MessageTemplate } from '../../messaging/types';
import { TICKET_LINK_PATH } from '../bookings.constants';
import type { BookingTicketsParams } from '../types';

/**
 * The tickets SMS to a phone on file (PRD "Email and SMS"): the essentials and the one-time
 * ticket link, which every stored copy redacts like the email's.
 */
export const bookingTicketsSmsTemplate: MessageTemplate<BookingTicketsParams> = {
  name: 'booking.tickets_sms',
  channel: 'sms',
  secretParams: ['qrCode'],
  render: (params, links) => ({
    text: `Maqady ${params.reference}: ${params.movieTitle}, ${params.startsAt}, ${params.theaterName} hall ${params.hallName}, seats ${params.seats}. Ticket: ${links.oneTime(TICKET_LINK_PATH, params.qrCode)}`,
  }),
};
