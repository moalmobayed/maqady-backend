import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import type { ShowtimeCancellationInput, ShowtimeCancellationOutcome } from './types';

/**
 * The seam through which cancelling a showtime cancels its bookings (design §5, §7.7). Bookings
 * (U14) provide it: refund every confirmed booking, release every live hold, and queue the
 * cancellation email and SMS for every ticket holder, all batched. `ShowtimesService` calls it
 * once, in the request transaction, with the showtime locked `FOR UPDATE` and before its status
 * changes, so an in-flight payment has committed and a later one sees the cancellation.
 *
 * `ShowtimesModule` binds the token to `RegisteredShowtimeCancellation` (U14): bookings imports
 * showtimes, so showtimes cannot import bookings, and bookings registers its implementation there
 * at boot instead (the registry pattern of `RegisteredTicketHolders`, U11).
 */
export abstract class ShowtimeCancellationService {
  abstract cancelBookings(input: ShowtimeCancellationInput): Promise<ShowtimeCancellationOutcome>;
}

/**
 * Before bookings existed, a showtime had nothing to refund, release or notify (U7). Kept for
 * suites that build showtimes without bookings; the app binds `RegisteredShowtimeCancellation`.
 */
@Injectable()
export class NoBookingsShowtimeCancellation extends ShowtimeCancellationService {
  cancelBookings(): Promise<ShowtimeCancellationOutcome> {
    return Promise.resolve({ refundedBookingCount: 0, releasedHoldCount: 0, notifiedCount: 0 });
  }
}

/**
 * The binding of `ShowtimeCancellationService` (U14): it calls the implementation bookings
 * registered at boot (`BookingsShowtimeCancellation`). Cancelling without one is `INTERNAL`,
 * never a silent "nobody refunded": a showtime with paid bookings must not be cancelled by a
 * wiring mistake. A second registration is a wiring bug and fails the start.
 */
@Injectable()
export class RegisteredShowtimeCancellation extends ShowtimeCancellationService {
  private implementation: ShowtimeCancellationService | undefined;

  register(implementation: ShowtimeCancellationService): void {
    if (this.implementation) {
      throw new AppError('INTERNAL', 'A showtime cancellation is registered twice.');
    }
    this.implementation = implementation;
  }

  cancelBookings(input: ShowtimeCancellationInput): Promise<ShowtimeCancellationOutcome> {
    if (!this.implementation) {
      return Promise.reject(
        new AppError(
          'INTERNAL',
          'No showtime cancellation is registered; bookings must be loaded.',
        ),
      );
    }
    return this.implementation.cancelBookings(input);
  }
}
