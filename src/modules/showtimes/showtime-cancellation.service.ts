import { Injectable } from '@nestjs/common';
import type { ShowtimeCancellationInput, ShowtimeCancellationOutcome } from './types';

/**
 * The seam through which cancelling a showtime cancels its bookings (design §5, §7.7). Bookings
 * (U14) provide it: refund every confirmed booking, release every live hold, and queue the
 * cancellation email and SMS for every ticket holder, all batched. `ShowtimesService` calls it
 * once, in the request transaction, with the showtime locked `FOR UPDATE` and before its status
 * changes, so an in-flight payment has committed and a later one sees the cancellation.
 *
 * `ShowtimesModule` binds `NoBookingsShowtimeCancellation` until bookings exist; U14 rebinds the
 * token (`{ provide: ShowtimeCancellationService, useClass: … }`) in the module that owns them.
 */
export abstract class ShowtimeCancellationService {
  abstract cancelBookings(input: ShowtimeCancellationInput): Promise<ShowtimeCancellationOutcome>;
}

/** Before bookings exist, a showtime has nothing to refund, release or notify. */
@Injectable()
export class NoBookingsShowtimeCancellation extends ShowtimeCancellationService {
  cancelBookings(): Promise<ShowtimeCancellationOutcome> {
    return Promise.resolve({ refundedBookingCount: 0, releasedHoldCount: 0, notifiedCount: 0 });
  }
}
