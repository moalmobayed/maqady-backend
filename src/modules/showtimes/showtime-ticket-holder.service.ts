import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import type { ShowtimeTicketHolder } from './types';

/**
 * The seam through which moving a showtime finds whom to notify (PRD "Showtimes" 5,
 * "Notifications"): the contact of every confirmed booking of the showtime, in one batched
 * query. Bookings (U10/U11) provide it; `ShowtimesService` calls it once per move, in the move's
 * transaction with the showtime locked `FOR UPDATE`, and queues one email per holder with an
 * email and one SMS per holder with a phone in a single insert.
 *
 * `ShowtimesModule` binds the token to `RegisteredTicketHolders` (U11): bookings imports showtimes,
 * so showtimes cannot import bookings, and bookings registers its source there at boot instead
 * (the registry pattern of U4b, U5 and U6).
 */
export abstract class ShowtimeTicketHolderService {
  abstract listTicketHolders(showtimeId: number): Promise<readonly ShowtimeTicketHolder[]>;
}

/**
 * The binding of `ShowtimeTicketHolderService` (U11): it asks the source bookings registered at
 * boot (`BookingTicketHolders`), and nobody holds a ticket before one registers. A second
 * registration is a wiring bug and fails the start.
 */
@Injectable()
export class RegisteredTicketHolders extends ShowtimeTicketHolderService {
  private source: ShowtimeTicketHolderService | undefined;

  register(source: ShowtimeTicketHolderService): void {
    if (this.source) {
      throw new AppError('INTERNAL', 'A ticket holder source is registered twice.');
    }
    this.source = source;
  }

  listTicketHolders(showtimeId: number): Promise<readonly ShowtimeTicketHolder[]> {
    return this.source ? this.source.listTicketHolders(showtimeId) : Promise.resolve([]);
  }
}
