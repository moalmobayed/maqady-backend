import { renderSimpleHtml } from '../../messaging/simple-html';
import type { MessageTemplate } from '../../messaging/types';
import type { ShowtimeMovedParams } from '../types';

/**
 * The "showtime moved" email to a ticket holder (PRD "Notifications": showtime moved → new time,
 * every ticket holder). Times are Cairo wall clock (`formatCairoDisplay`); nothing in it is
 * secret, so the stored copy is the sent one.
 */
export const showtimeMovedTemplate: MessageTemplate<ShowtimeMovedParams> = {
  name: 'showtime.moved',
  channel: 'email',
  secretParams: [],
  render: (
    { bookingReference, movieTitle, theaterName, hallName, previousStartsAt, startsAt },
    links,
  ) => {
    const booking = links.page(`/bookings/${encodeURIComponent(bookingReference)}`);
    const moved = `The showtime of ${movieTitle} you have tickets for at ${theaterName}, ${hallName}, has moved.`;
    const times = `New time: ${startsAt} (was ${previousStartsAt}).`;
    const tickets = `Your booking ${bookingReference} and its seats stay the same, and your tickets are valid for the new time.`;
    const contact = 'If the new time does not suit you, contact the cinema before the showtime.';
    return {
      subject: `New time for ${movieTitle}: ${startsAt}`,
      text: [moved, times, tickets, contact, `Your booking: ${booking}`].join('\n\n'),
      html: renderSimpleHtml({
        heading: `${movieTitle} has a new time`,
        paragraphs: [moved, times, tickets, contact],
        action: { label: 'View booking', url: booking },
      }),
    };
  },
};
