import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { HallsModule } from '../halls/halls.module';
import { MediaModule } from '../media/media.module';
import { SeatingModule } from '../seating/seating.module';
import { ShowtimesModule } from '../showtimes/showtimes.module';
import { TheatersModule } from '../theaters/theaters.module';
import { BookingReadService } from './booking-read.service';
import { BookingResponseMapper } from './booking-response.mapper';
import { BookingShowtimeService } from './booking-showtime.service';
import { BookingsController } from './bookings.controller';
import { BookingsRepository } from './bookings.repository';
import { HoldsController } from './holds.controller';
import { HoldsService } from './holds.service';
import { PublicShowtimesController } from './public-showtimes.controller';
import { ShowtimeSeatMapService } from './showtime-seat-map.service';

/**
 * Bookings (design §5, §7.3, §7.4; PRD "Seats and holds"): `bookings` and `booking_seats`, holds
 * for guests and customers, claiming a guest hold at sign-in, releasing, the public seat page,
 * and `GET /bookings/{ref}`. It reads showtimes, halls, theaters, catalog and customers through
 * their exported services and writes seat claims through seating.
 *
 * Exported for checkout, My Bookings, the box office and admin bookings (U11–U14), which extend
 * this module: `HoldsService`, `BookingReadService`, `BookingShowtimeService` and
 * `BookingResponseMapper`.
 */
@Module({
  imports: [
    ShowtimesModule,
    HallsModule,
    CatalogModule,
    TheatersModule,
    CustomersModule,
    SeatingModule,
    MediaModule,
  ],
  controllers: [PublicShowtimesController, HoldsController, BookingsController],
  providers: [
    BookingsRepository,
    BookingShowtimeService,
    HoldsService,
    BookingReadService,
    ShowtimeSeatMapService,
    BookingResponseMapper,
  ],
  exports: [HoldsService, BookingReadService, BookingShowtimeService, BookingResponseMapper],
})
export class BookingsModule {}
