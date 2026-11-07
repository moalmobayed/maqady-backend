import { renderSimpleHtml } from '../../messaging/simple-html';
import type { MessageTemplate } from '../../messaging/types';
import { MY_BOOKINGS_PATH } from '../bookings.constants';
import type { ShowtimeCancelledParams } from '../types';

/**
 * The cancellation and refund notice (PRD "Email and SMS": showtime cancelled → cancellation and
 * refund notice by email to every ticket holder; design §7.7). One per refunded booking with an
 * email; nothing in it is secret.
 */
export const showtimeCancelledTemplate: MessageTemplate<ShowtimeCancelledParams> = {
  name: 'showtime.cancelled',
  channel: 'email',
  secretParams: [],
  render: (params, links) => {
    const booking = links.page(`${MY_BOOKINGS_PATH}/${params.reference}`);
    const greeting = params.customerName === null ? 'Hello,' : `Hello ${params.customerName},`;
    const cancelled = `We are sorry: the showtime of ${params.movieTitle} at ${params.theaterName}, ${params.hallName}, on ${params.startsAt} has been cancelled.`;
    const refunded = `Your booking ${params.reference} is refunded in full: ${params.amount}.`;
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
    return {
      subject: `Cancelled: ${params.movieTitle} on ${params.startsAt}`,
      text: [greeting, cancelled, refunded, ...where, `Your booking: ${booking}`].join('\n\n'),
      html: renderSimpleHtml({
        heading: `${params.movieTitle} is cancelled`,
        paragraphs: [greeting, cancelled, refunded, ...where],
        action: { label: 'View booking', url: booking },
      }),
    };
  },
};
