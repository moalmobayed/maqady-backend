import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { HallsModule } from '../halls/halls.module';
import { MediaModule } from '../media/media.module';
import { PaymentsModule } from '../payments/payments.module';
import { SeatingModule } from '../seating/seating.module';
import { ShowtimesModule } from '../showtimes/showtimes.module';
import { StaffModule } from '../staff/staff.module';
import { TheatersModule } from '../theaters/theaters.module';
import { BookingConfirmationService } from './booking-confirmation.service';
import { BookingHistoryController } from './booking-history.controller';
import { BookingHistoryService } from './booking-history.service';
import { BookingPaymentsController } from './booking-payments.controller';
import { BookingReadService } from './booking-read.service';
import { BookingResponseMapper } from './booking-response.mapper';
import { BookingShowtimeService } from './booking-showtime.service';
import { BookingTicketHolders } from './booking-ticket-holders.service';
import { BookingTicketsController } from './booking-tickets.controller';
import { BookingViews } from './booking-views.service';
import { BoxOfficeController } from './box-office.controller';
import { BookingsController } from './bookings.controller';
import { BookingsRepository } from './bookings.repository';
import { CheckoutService } from './checkout.service';
import { CounterSalesService } from './counter-sales.service';
import { HoldsController } from './holds.controller';
import { HoldsService } from './holds.service';
import { MyBookingsController } from './my-bookings.controller';
import { MyBookingsService } from './my-bookings.service';
import { PublicShowtimesController } from './public-showtimes.controller';
import { QrCodeService } from './qr-code.service';
import { ScanService } from './scan.service';
import { ScansController } from './scans.controller';
import { SettleFirstInterceptor } from './settle-first.interceptor';
import { SettlementService } from './settlement.service';
import { ShowtimeSeatMapService } from './showtime-seat-map.service';
import { StaffTicketsService } from './staff-tickets.service';
import { BookingTemplatesRegistrar } from './templates/booking-templates.registrar';
import { TicketDeliveriesController } from './ticket-deliveries.controller';
import { TicketDeliveryService } from './ticket-delivery.service';
import { TicketsService } from './tickets.service';

/**
 * Bookings (design §5, §7.3–§7.5, §7.9; PRD "Seats and holds", "Payments", "Tickets and QR
 * codes"): `bookings` and `booking_seats`, holds for guests and customers, claiming a guest hold
 * at sign-in, releasing, the public seat page, `GET /bookings/{ref}` (U10); checkout, settlement,
 * confirmation and the tickets (U11); My Bookings, a booking's History and "Email again" (U12);
 * counter holds and sales, the staff ticket download and ticket scanning (U13,
 * `docs/gh-14-box-office/spec.md`). It reads showtimes, halls, theaters, catalog and customers
 * (and staff, for a counter hold's member) through their exported services, writes seat claims
 * through seating and payments through
 * payments.
 *
 * Exported for My Bookings, the box office and admin bookings (U12–U14), which extend this
 * module: `HoldsService`, `BookingReadService`, `BookingShowtimeService`,
 * `BookingResponseMapper`, `SettlementService`, `BookingConfirmationService`, `TicketsService`,
 * `QrCodeService` and `SettleFirstInterceptor` (registered globally by `AppModule`); for the
 * admin booking list and detail (U14), `BookingViews` (`ofMany()`, a fixed query count) and
 * `BookingHistoryService` (`ofBooking()`).
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
    StaffModule,
  ],
  controllers: [
    PublicShowtimesController,
    HoldsController,
    BookingsController,
    BookingPaymentsController,
    BookingTicketsController,
    MyBookingsController,
    BookingHistoryController,
    TicketDeliveriesController,
    BoxOfficeController,
    ScansController,
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
    MyBookingsService,
    BookingHistoryService,
    TicketDeliveryService,
    CounterSalesService,
    ScanService,
    StaffTicketsService,
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
    BookingViews,
    BookingHistoryService,
  ],
})
export class BookingsModule {}
