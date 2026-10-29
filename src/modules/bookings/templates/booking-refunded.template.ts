import { renderSimpleHtml } from '../../messaging/simple-html';
import type { MessageTemplate } from '../../messaging/types';
import { MY_BOOKINGS_PATH } from '../bookings.constants';
import type { BookingRefundedParams } from '../types';

/**
 * The refund notice (PRD "Email and SMS": booking cancelled and refunded → refund notice, email
 * only, to the customer; design §7.7). Sent when an admin cancels and refunds a booking: it says
 * the booking is cancelled, the full amount, and where the money goes (back to the card or wallet,
 * or to collect at the box office). Nothing in it is secret, so the stored copy is the sent one.
 */
export const bookingRefundedTemplate: MessageTemplate<BookingRefundedParams> = {
  name: 'booking.refunded',
  channel: 'email',
  secretParams: [],
  render: (params, links) => {
    const booking = links.page(`${MY_BOOKINGS_PATH}/${params.reference}`);
    const greeting = params.customerName === null ? 'Hello,' : `Hello ${params.customerName},`;
    const cancelled = `Your booking ${params.reference} for ${params.movieTitle} at ${params.theaterName} on ${params.startsAt} has been cancelled by the cinema and refunded in full: ${params.amount}.`;
    const where = [
      ...(params.onlineAmount === null
        ? []
        : [
            `${params.onlineAmount} goes back to the card or wallet you paid with. Banks usually show it within 5 to 10 days.`,
          ]),
      ...(params.counterAmount === null
        ? []
        : [
            `${params.counterAmount} is waiting for you at the box office of ${params.theaterName}.`,
          ]),
    ];
    const seats = 'Your seats are released and your tickets no longer admit anyone.';
    return {
      subject: `Your Maqady booking ${params.reference} is cancelled and refunded`,
      text: [greeting, cancelled, ...where, seats, `Your booking: ${booking}`].join('\n\n'),
      html: renderSimpleHtml({
        heading: `Booking ${params.reference} refunded`,
        paragraphs: [greeting, cancelled, ...where, seats],
        action: { label: 'View booking', url: booking },
      }),
    };
  },
};
