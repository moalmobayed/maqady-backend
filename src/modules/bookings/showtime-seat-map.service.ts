import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { HallReadService } from '../halls/hall-read.service';
import { SeatAvailabilityService } from '../seating/seat-availability.service';
import { notBookableReason } from './bookability';
import { BookingShowtimeService } from './booking-showtime.service';
import type { SeatMapAvailability, ShowtimeSeatMap } from './types';

/**
 * The public seat page (PRD C6; design §11, §12): `GET /showtimes/{id}` and `/seats`. Both show
 * a showtime of any published theater in any status, with `bookable` and its reason, so a
 * customer whose showtime started, was cancelled or whose theater paused sales is told why. A
 * showtime of a draft theater, or an unknown id, is `NOT_FOUND`. Each read costs a fixed number
 * of queries.
 */
@Injectable()
export class ShowtimeSeatMapService {
  constructor(
    private readonly showtimes: BookingShowtimeService,
    private readonly halls: HallReadService,
    private readonly availability: SeatAvailabilityService,
    private readonly clock: Clock,
  ) {}

  /** The header, the hall's layout and prices, and whether the showtime can be held now. */
  async header(showtimeId: number): Promise<ShowtimeSeatMap> {
    const context = await this.showtimes.publicContext(showtimeId);
    if (!context) throw new AppError('NOT_FOUND');
    const hall = await this.halls.findById(context.view.hallId);
    const layout = await this.halls.findLayout(context.view.hallId);
    if (!hall || !layout) {
      throw new AppError('INTERNAL', 'A showtime references a hall that does not exist.');
    }
    const reason = notBookableReason(
      {
        showtimeStatus: context.view.status,
        startsAt: context.view.startsAt,
        theaterStatus: context.theaterStatus,
        movieStatus: context.movieStatus,
        hallStatus: hall.status,
      },
      this.clock.now(),
    );
    return {
      showtime: context.header,
      prices: context.view.prices,
      fromPrice: context.view.fromPrice,
      seatCapacity: context.view.seatCapacity,
      layout,
      bookable: reason === null,
      notBookableReason: reason,
    };
  }

  /** The taken seats right now and how many are left; live updates come over `/ws`. */
  async seats(showtimeId: number): Promise<SeatMapAvailability> {
    const context = await this.showtimes.publicContext(showtimeId);
    if (!context) throw new AppError('NOT_FOUND');
    const snapshot = await this.availability.snapshot(showtimeId);
    const availableCount = Math.max(0, context.view.seatCapacity - snapshot.seats.length);
    return { snapshot, availableCount, soldOut: availableCount === 0 };
  }
}
