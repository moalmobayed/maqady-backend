import { Module } from '@nestjs/common';
import { AdminCustomersModule } from '../admin-customers/admin-customers.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { BookingsModule } from '../bookings/bookings.module';
import { ExportOptions } from './export-options';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

/**
 * The admin CSV exports (U19, `docs/gh-20-exports-activity/spec.md`; design §13.4): Overview,
 * Bookings, Customers and Payments, streamed with formula escaping and audited.
 *
 * It owns no table and has no repository: every row comes from its screen's exported service
 * and response mapper (bookings' `AdminBookingsService`, admin-customers' `AdminCustomersService`,
 * analytics' `PaymentsReportService` and `OverviewService`), so a file is its screen. It writes
 * only its `export.downloaded` audit events (the global `AuditService`).
 */
@Module({
  imports: [BookingsModule, AdminCustomersModule, AnalyticsModule],
  controllers: [ExportsController],
  providers: [ExportOptions, ExportsService],
  exports: [ExportsService],
})
export class ExportsModule {}
