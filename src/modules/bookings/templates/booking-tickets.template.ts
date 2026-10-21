import { renderSimpleHtml } from '../../messaging/simple-html';
import type { MessageTemplate } from '../../messaging/types';
import { MY_BOOKINGS_PATH, TICKET_LINK_PATH } from '../bookings.constants';
import type { BookingTicketsParams } from '../types';

const POLICY =
  "This booking can't be cancelled or refunded. If you can't make it, contact the cinema before the showtime.";

/**
 * The tickets email (PRD "Email and SMS": booking confirmed → tickets; design §7.9, §13.1). The
 * QR payload admits its holder, so it is a secret parameter: the email carries it only inside a
 * one-time link to the frontend's `/ticket?token=<payload>` page, which draws the code. Every
 * stored copy (the Message log) shows `[one-time link hidden]` there instead. The booking page
 * link is an ordinary one, shown everywhere.
 */
export const bookingTicketsTemplate: MessageTemplate<BookingTicketsParams> = {
  name: 'booking.tickets',
  channel: 'email',
  secretParams: ['qrCode'],
  render: (params, links) => {
    const ticket = links.oneTime(TICKET_LINK_PATH, params.qrCode);
    const booking = links.page(`${MY_BOOKINGS_PATH}/${params.reference}`);
    const greeting = params.customerName === null ? 'Hello,' : `Hello ${params.customerName},`;
    const confirmed = `Your booking ${params.reference} is confirmed. Here are your tickets.`;
    const details = [
      `${params.movieTitle} (${params.ageRating})`,
      `${params.startsAt}`,
      `${params.theaterName}, ${params.theaterAddress}`,
      `${params.hallName} · Seats ${params.seats}`,
      `Admits ${params.admits} · Total paid ${params.total}`,
    ];
    const entrance = `Show the ticket QR code at the entrance. It admits ${params.admits}.`;
    const manage = `Your booking, the PDF ticket and "Add to calendar": ${booking}`;
    return {
      subject: `Your Maqady tickets · ${params.reference}`,
      text: [
        greeting,
        confirmed,
        details.join('\n'),
        `Your ticket QR code: ${ticket}`,
        entrance,
        manage,
        POLICY,
      ].join('\n\n'),
      html: renderSimpleHtml({
        heading: `Your tickets for ${params.movieTitle}`,
        paragraphs: [greeting, confirmed, ...details, entrance, manage, POLICY],
        action: { label: 'Show ticket QR code', url: ticket },
      }),
    };
  },
};
