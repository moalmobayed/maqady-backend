import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { PaymentsModule } from '../payments/payments.module';
import { StaffModule } from '../staff/staff.module';
import { AdminPaymentsController } from './admin-payments.controller';
import { PaymentsReportResponseMapper } from './payments-report-response.mapper';
import { PaymentsReportRepository } from './payments-report.repository';
import { PaymentsReportService } from './payments-report.service';

/**
 * Analytics (design §5, §13.3): the read-only figures of the admin dashboard, computed on read
 * with SQL aggregates after a batched settlement, never from rollup tables. U16 adds the Payments
 * screen (transactions, KPIs, reconciliation, `docs/gh-17-payments-screen/spec.md`); the Overview
 * and the bell follow (U17).
 *
 * It reads `payments`, `bookings`, `showtimes`, `theaters` in its own queries (a read-only module,
 * design §5) and writes nothing; it uses bookings' `SettlementService`, payments'
 * `PaymentProvider` (the provider check) and staff's `StaffService` (names). Exported:
 * `PaymentsReportService` for the Overview (U17) and the payments CSV (U19).
 */
@Module({
  imports: [BookingsModule, PaymentsModule, StaffModule],
  controllers: [AdminPaymentsController],
  providers: [PaymentsReportRepository, PaymentsReportService, PaymentsReportResponseMapper],
  exports: [PaymentsReportService],
})
export class AnalyticsModule {}
