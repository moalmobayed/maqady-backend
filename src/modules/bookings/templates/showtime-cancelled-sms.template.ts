import type { MessageTemplate } from '../../messaging/types';
import type { ShowtimeCancelledParams } from '../types';

/**
 * The cancellation notice by SMS (PRD "Email and SMS": showtime cancelled → cancellation notice,
 * every ticket holder with a phone; design §7.7). Short, and nothing in it is secret.
 */
export const showtimeCancelledSmsTemplate: MessageTemplate<ShowtimeCancelledParams> = {
  name: 'showtime.cancelled_sms',
  channel: 'sms',
  secretParams: [],
  render: (params) => ({
    text: `Maqady ${params.reference}: ${params.movieTitle} on ${params.startsAt} at ${params.theaterName} is cancelled. You are refunded ${params.amount}.`,
  }),
};
