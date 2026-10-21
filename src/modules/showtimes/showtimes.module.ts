import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { HallsModule } from '../halls/halls.module';
import { SeatAvailabilityService } from '../seating/seat-availability.service';
import { SeatingModule } from '../seating/seating.module';
import { TheatersModule } from '../theaters/theaters.module';
import { AdminShowtimeChecksController } from './admin-showtime-checks.controller';
import { AdminShowtimesController } from './admin-showtimes.controller';
import {
  NoBookingsShowtimeCancellation,
  ShowtimeCancellationService,
} from './showtime-cancellation.service';
import { ShowtimeLifecycleHooks } from './showtime-lifecycle.hooks';
import { ShowtimeReadService } from './showtime-read.service';
import { ShowtimeSchedulingService } from './showtime-scheduling.service';
import { ShowtimeSeatClaimService } from './showtime-seat-claim.service';
import { NoTicketHolders, ShowtimeTicketHolderService } from './showtime-ticket-holder.service';
import { ShowtimesRepository } from './showtimes.repository';
import { ShowtimesService } from './showtimes.service';

/**
 * Showtimes (design §5, §8; PRD "Showtimes", A5): the admin scheduling routes, the showtime
 * rules of halls, theaters and movies, and for later units
 *
 * - `ShowtimeReadService`: showtimes by id, by movie, by theater and date (U8, U10, U14);
 * - the booking seams `ShowtimeCancellationService` (U14) and `ShowtimeTicketHolderService`
 *   (U11), bound here to their no-bookings defaults, and `ShowtimeSeatClaimService`, bound to
 *   seating's live claims (U10). Later units replace the bindings here, in this module's
 *   `providers` (`useExisting` the implementation their own module exports, that module imported
 *   here): this module's own provider wins over an imported one, so a binding made only in their
 *   module has no effect.
 */
@Module({
  imports: [TheatersModule, HallsModule, CatalogModule, SeatingModule],
  controllers: [AdminShowtimesController, AdminShowtimeChecksController],
  providers: [
    ShowtimesRepository,
    ShowtimeSchedulingService,
    ShowtimeReadService,
    ShowtimesService,
    ShowtimeLifecycleHooks,
    { provide: ShowtimeCancellationService, useClass: NoBookingsShowtimeCancellation },
    { provide: ShowtimeTicketHolderService, useClass: NoTicketHolders },
    // U10: live seat claims from seating, judged by their stored expiry (HALL_IN_USE).
    { provide: ShowtimeSeatClaimService, useExisting: SeatAvailabilityService },
  ],
  exports: [
    ShowtimeReadService,
    ShowtimeCancellationService,
    ShowtimeTicketHolderService,
    ShowtimeSeatClaimService,
  ],
})
export class ShowtimesModule {}
