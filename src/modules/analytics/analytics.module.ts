import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { PaymentsModule } from '../payments/payments.module';
import { StaffModule } from '../staff/staff.module';
import { TheatersModule } from '../theaters/theaters.module';
import { AdminAlertsController } from './admin-alerts.controller';
import { AdminOverviewController } from './admin-overview.controller';
import { AdminPaymentsController } from './admin-payments.controller';
import { AlertsResponseMapper } from './alerts-response.mapper';
import { AlertsRepository } from './alerts.repository';
import { AlertsService } from './alerts.service';
import { OverviewResponseMapper } from './overview-response.mapper';
import { OverviewRepository } from './overview.repository';
import { OverviewService } from './overview.service';
import { PaymentsReportResponseMapper } from './payments-report-response.mapper';
import { PaymentsReportRepository } from './payments-report.repository';
import { PaymentsReportService } from './payments-report.service';

/**
 * Analytics (design §5, §13.3): the read-only figures of the admin dashboard, computed on read
 * with SQL aggregates after a batched settlement, never from rollup tables. U16 adds the Payments
 * screen (transactions, KPIs, reconciliation, `docs/gh-17-payments-screen/spec.md`); U17 the
 * Overview and the bell (`docs/gh-18-overview-alerts/spec.md`).
 *
 * It reads `payments`, `bookings`, `showtimes`, `theaters`, `halls` and `movies` in its own
 * queries (a read-only module, design §5) and writes only `staff_alert_reads`, the bell's read
 * state, which it owns; it uses bookings' `SettlementService`, payments' `PaymentProvider` (the
 * provider check), staff's `StaffService` (names) and theaters' `TheaterHoursService` (open days
 * of a hall gap). Exported: `PaymentsReportService`, `OverviewService` and `AlertsService` for the
 * CSV exports (U19), with `PaymentsReportResponseMapper` and `OverviewResponseMapper`, so a CSV
 * row is built from the response its screen answers.
 */
@Module({
  imports: [BookingsModule, PaymentsModule, StaffModule, TheatersModule],
  controllers: [AdminPaymentsController, AdminOverviewController, AdminAlertsController],
  providers: [
    PaymentsReportRepository,
    PaymentsReportService,
    PaymentsReportResponseMapper,
    OverviewRepository,
    OverviewService,
    OverviewResponseMapper,
    AlertsRepository,
    AlertsService,
    AlertsResponseMapper,
  ],
  exports: [
    PaymentsReportService,
    OverviewService,
    AlertsService,
    PaymentsReportResponseMapper,
    OverviewResponseMapper,
  ],
})
export class AnalyticsModule {}
