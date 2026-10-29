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
import { AdminBookingResponseMapper } from './admin-booking-response.mapper';
import { AdminBookingsController } from './admin-bookings.controller';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminRefundsController } from './admin-refunds.controller';
import { AdminShowtimeCancellationController } from './admin-showtime-cancellation.controller';
import { BookingConfirmationService } from './booking-confirmation.service';
import { BookingEditsService } from './booking-edits.service';
import { BookingHistoryController } from './booking-history.controller';
import { BookingHistoryService } from './booking-history.service';
import { BookingNotesRepository } from './booking-notes.repository';
import { BookingNotesService } from './booking-notes.service';
import { BookingPaymentsController } from './booking-payments.controller';
import { BookingReadService } from './booking-read.service';
import { BookingRefundsService } from './booking-refunds.service';
import { BookingResponseMapper } from './booking-response.mapper';
import { BookingShowtimeService } from './booking-showtime.service';
import { BookingTicketHolders } from './booking-ticket-holders.service';
import { BookingTicketsController } from './booking-tickets.controller';
import { BookingViews } from './booking-views.service';
import { BoxOfficeController } from './box-office.controller';
import { BookingsController } from './bookings.controller';
import { BookingsShowtimeCancellation } from './bookings-showtime-cancellation.service';
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
import { StaffRefsService } from './staff-refs.service';
import { StaffTicketDeliveryService } from './staff-ticket-delivery.service';
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
 * `docs/gh-14-box-office/spec.md`); the admin bookings list, summary, detail, notes, staff resend,
 * cancel and refund, payouts, edits and the showtime cancellation (U14,
 * `docs/gh-15-admin-bookings/spec.md`). It reads showtimes, halls, theaters, catalog and customers
 * (and staff, for a counter hold's member) through their exported services, writes seat claims
 * through seating and payments through
 * payments.
 *
 * Exported for My Bookings, the box office and admin bookings (U12–U14), which extend this
 * module: `HoldsService`, `BookingReadService`, `BookingShowtimeService`,
 * `BookingResponseMapper`, `SettlementService`, `BookingConfirmationService`, `TicketsService`,
 * `QrCodeService` and `SettleFirstInterceptor` (registered globally by `AppModule`); for the
 * admin booking list and detail (U14), `BookingViews` (`ofMany()`, a fixed query count) and
 * `BookingHistoryService` (`ofBooking()`); from U14, `BookingNotesService` (anonymisation deletes
 * notes, U15), `BookingRefundsService` and `AdminBookingsService` (the list filters, U19).
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
    AdminBookingsController,
    AdminRefundsController,
    AdminShowtimeCancellationController,
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
    BookingNotesRepository,
    BookingNotesService,
    StaffRefsService,
    AdminBookingsService,
    AdminBookingResponseMapper,
    StaffTicketDeliveryService,
    BookingRefundsService,
    BookingEditsService,
    BookingsShowtimeCancellation,
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
    BookingNotesService,
    BookingRefundsService,
    AdminBookingsService,
  ],
})
export class BookingsModule {}
