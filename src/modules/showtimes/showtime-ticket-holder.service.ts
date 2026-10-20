import { Injectable } from '@nestjs/common';
import type { ShowtimeTicketHolder } from './types';

/**
 * The seam through which moving a showtime finds whom to notify (PRD "Showtimes" 5,
 * "Notifications"): the contact of every confirmed booking of the showtime, in one batched
 * query. Bookings (U10/U11) provide it; `ShowtimesService` calls it once per move, in the move's
 * transaction with the showtime locked `FOR UPDATE`, and queues one email per holder with an
 * email and one SMS per holder with a phone in a single insert.
 *
 * `ShowtimesModule` binds `NoTicketHolders` until bookings exist; U10/U11 rebind the token.
 */
export abstract class ShowtimeTicketHolderService {
  abstract listTicketHolders(showtimeId: number): Promise<readonly ShowtimeTicketHolder[]>;
}

/** Before bookings exist, nobody holds a ticket. */
@Injectable()
export class NoTicketHolders extends ShowtimeTicketHolderService {
  listTicketHolders(): Promise<readonly ShowtimeTicketHolder[]> {
    return Promise.resolve([]);
  }
}
