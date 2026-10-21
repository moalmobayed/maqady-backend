import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { HallsModule } from '../halls/halls.module';
import { MediaModule } from '../media/media.module';
import { PaymentsModule } from '../payments/payments.module';
import { SeatingModule } from '../seating/seating.module';
import { ShowtimesModule } from '../showtimes/showtimes.module';
import { TheatersModule } from '../theaters/theaters.module';
import { BookingConfirmationService } from './booking-confirmation.service';
import { BookingPaymentsController } from './booking-payments.controller';
import { BookingReadService } from './booking-read.service';
import { BookingResponseMapper } from './booking-response.mapper';
import { BookingShowtimeService } from './booking-showtime.service';
import { BookingTicketHolders } from './booking-ticket-holders.service';
import { BookingTicketsController } from './booking-tickets.controller';
import { BookingViews } from './booking-views.service';
import { BookingsController } from './bookings.controller';
import { BookingsRepository } from './bookings.repository';
import { CheckoutService } from './checkout.service';
import { HoldsController } from './holds.controller';
import { HoldsService } from './holds.service';
import { PublicShowtimesController } from './public-showtimes.controller';
import { QrCodeService } from './qr-code.service';
import { SettleFirstInterceptor } from './settle-first.interceptor';
import { SettlementService } from './settlement.service';
import { ShowtimeSeatMapService } from './showtime-seat-map.service';
import { BookingTemplatesRegistrar } from './templates/booking-templates.registrar';
import { TicketsService } from './tickets.service';

/**
 * Bookings (design §5, §7.3–§7.5, §7.9; PRD "Seats and holds", "Payments", "Tickets and QR
 * codes"): `bookings` and `booking_seats`, holds for guests and customers, claiming a guest hold
 * at sign-in, releasing, the public seat page, `GET /bookings/{ref}` (U10); checkout, settlement,
 * confirmation and the tickets (U11). It reads showtimes, halls, theaters, catalog and customers
 * through their exported services, writes seat claims through seating and payments through
 * payments.
 *
 * Exported for My Bookings, the box office and admin bookings (U12–U14), which extend this
 * module: `HoldsService`, `BookingReadService`, `BookingShowtimeService`,
 * `BookingResponseMapper`, `SettlementService`, `BookingConfirmationService`, `TicketsService`,
 * `QrCodeService` and `SettleFirstInterceptor` (registered globally by `AppModule`).
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
    PaymentsModule,
  ],
  controllers: [
    PublicShowtimesController,
    HoldsController,
    BookingsController,
    BookingPaymentsController,
    BookingTicketsController,
  ],
  providers: [
    BookingsRepository,
    BookingShowtimeService,
    HoldsService,
    BookingReadService,
    ShowtimeSeatMapService,
    BookingResponseMapper,
    BookingViews,
    QrCodeService,
    TicketsService,
    BookingConfirmationService,
    CheckoutService,
    SettlementService,
    SettleFirstInterceptor,
    BookingTicketHolders,
    BookingTemplatesRegistrar,
  ],
  exports: [
    HoldsService,
    BookingReadService,
    BookingShowtimeService,
    BookingResponseMapper,
    SettlementService,
    BookingConfirmationService,
    TicketsService,
    QrCodeService,
    SettleFirstInterceptor,
  ],
})
export class BookingsModule {}
