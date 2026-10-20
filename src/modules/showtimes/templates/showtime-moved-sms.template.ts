import type { MessageTemplate } from '../../messaging/types';
import type { ShowtimeMovedParams } from '../types';

/** The "showtime moved" SMS to a ticket holder with a phone (PRD "Notifications"). */
export const showtimeMovedSmsTemplate: MessageTemplate<ShowtimeMovedParams> = {
  name: 'showtime.moved_sms',
  channel: 'sms',
  secretParams: [],
  render: ({ bookingReference, movieTitle, theaterName, startsAt }) => ({
    text: `Maqady: ${movieTitle} at ${theaterName} has moved to ${startsAt}. Booking ${bookingReference} stays valid.`,
  }),
};
