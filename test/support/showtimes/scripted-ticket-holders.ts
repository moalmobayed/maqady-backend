import { Injectable } from '@nestjs/common';
import { ShowtimeTicketHolderService } from '../../../src/modules/showtimes/showtime-ticket-holder.service';
import type { ShowtimeTicketHolder } from '../../../src/modules/showtimes/types';

/**
 * Our own implementation of our own seam (`ShowtimeTicketHolderService`), standing in for the
 * bookings U10/U11 bring: a suite sets the holders of a showtime, and every call is recorded.
 */
@Injectable()
export class ScriptedTicketHolders extends ShowtimeTicketHolderService {
  readonly holders = new Map<number, ShowtimeTicketHolder[]>();
  readonly calls: number[] = [];

  reset(): void {
    this.holders.clear();
    this.calls.length = 0;
  }

  listTicketHolders(showtimeId: number): Promise<readonly ShowtimeTicketHolder[]> {
    this.calls.push(showtimeId);
    return Promise.resolve(this.holders.get(showtimeId) ?? []);
  }
}
