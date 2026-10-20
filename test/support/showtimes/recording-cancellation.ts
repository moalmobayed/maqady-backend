import { Injectable } from '@nestjs/common';
import { ShowtimeCancellationService } from '../../../src/modules/showtimes/showtime-cancellation.service';
import type {
  ShowtimeCancellationInput,
  ShowtimeCancellationOutcome,
} from '../../../src/modules/showtimes/types';

/**
 * Our own implementation of our own seam (`ShowtimeCancellationService`), standing in for the
 * bookings U14 brings: it records each call (the showtime it gets is as it was before the
 * cancellation) and answers `outcome`.
 */
@Injectable()
export class RecordingCancellation extends ShowtimeCancellationService {
  readonly calls: ShowtimeCancellationInput[] = [];
  outcome: ShowtimeCancellationOutcome = {
    refundedBookingCount: 0,
    releasedHoldCount: 0,
    notifiedCount: 0,
  };

  reset(): void {
    this.calls.length = 0;
    this.outcome = { refundedBookingCount: 0, releasedHoldCount: 0, notifiedCount: 0 };
  }

  cancelBookings(input: ShowtimeCancellationInput): Promise<ShowtimeCancellationOutcome> {
    this.calls.push(input);
    return Promise.resolve(this.outcome);
  }
}
