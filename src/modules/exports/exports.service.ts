import { Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { AuditService } from '../../common/audit/audit.service';
import type { AuditMetadataValue } from '../../common/audit/types';
import type { StaffPrincipal } from '../../common/auth/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { Clock } from '../../common/time/clock';
import { cinemaDateOf } from '../../common/time/time';
import { AdminCustomerResponseMapper } from '../admin-customers/admin-customer-response.mapper';
import { AdminCustomersService } from '../admin-customers/admin-customers.service';
import { OverviewResponseMapper } from '../analytics/overview-response.mapper';
import { OverviewService } from '../analytics/overview.service';
import { PaymentsReportResponseMapper } from '../analytics/payments-report-response.mapper';
import { PaymentsReportService } from '../analytics/payments-report.service';
import type { OverviewQuery, TransactionFilter } from '../analytics/types';
import { AdminBookingResponseMapper } from '../bookings/admin-booking-response.mapper';
import { AdminBookingsService } from '../bookings/admin-bookings.service';
import type { AdminBookingFilter } from '../bookings/types';
import type { AdminCustomerFilter } from '../customers/types';
import { csvStream, mapBatches } from './csv';
import {
  BOOKING_COLUMNS,
  CUSTOMER_COLUMNS,
  OVERVIEW_COLUMNS,
  PAYMENT_COLUMNS,
} from './export-columns';
import { ExportOptions } from './export-options';
import { EXPORT_DOWNLOADED_ACTION, EXPORT_ENTITY } from './exports.constants';
import { overviewRows } from './overview-rows';
import type { ExportAuditMetadata, ExportDataset, ExportFile, ExportFilters } from './types';

/**
 * The admin CSV exports (PRD "CSV exports"; design §13.4), admins only: the Overview of the
 * current view, the Bookings and Customers tables with their current filters, and the Payments
 * transactions of a chosen period.
 *
 * Each export, in order:
 *
 * 1. reads through its screen's own service, which checks the filters exactly as the screen
 *    does and settles due payments once (a refusal answers as the screen would, and records
 *    nothing);
 * 2. builds the CSV stream and reads its first batch, so a failure up to there is an ordinary
 *    error of the request;
 * 3. records `export.downloaded` in a short transaction of its own (a GET has none, design §14.1),
 *    because the file holds personal data. The metadata names the dataset and the filters, a
 *    search only as `search: true`: the text could be a name, an email or a phone (design §13.5);
 * 4. answers the file, whose later batches are read as the client takes them.
 *
 * Every row is the list's response DTO for that row, so the file shows what the screen shows.
 */
@Injectable()
export class ExportsService {
  constructor(
    private readonly adminBookings: AdminBookingsService,
    private readonly bookingResponses: AdminBookingResponseMapper,
    private readonly adminCustomers: AdminCustomersService,
    private readonly customerResponses: AdminCustomerResponseMapper,
    private readonly paymentsReport: PaymentsReportService,
    private readonly paymentResponses: PaymentsReportResponseMapper,
    private readonly overviews: OverviewService,
    private readonly overviewResponses: OverviewResponseMapper,
    private readonly options: ExportOptions,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /** `GET /admin/exports/overview.csv`: the figures of `GET /admin/overview` for this query. */
  async overview(staff: StaffPrincipal, query: OverviewQuery): Promise<ExportFile> {
    const overview = this.overviewResponses.overview(await this.overviews.read(query));
    // The Overview is a bounded set of figures, already in memory: one batch.
    const stream = await csvStream([overviewRows(overview)], OVERVIEW_COLUMNS);
    return this.recorded(staff, 'overview', stream, {
      period: query.period,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      theaterId: query.theaterId,
    });
  }

  /** `GET /admin/exports/bookings.csv`: every row of `GET /admin/bookings` with these filters. */
  async bookings(staff: StaffPrincipal, filter: AdminBookingFilter): Promise<ExportFile> {
    const batches = await this.adminBookings.exportBatches(filter, this.options.batchSize);
    const stream = await csvStream(
      mapBatches(batches, (item) => this.bookingResponses.listItem(item)),
      BOOKING_COLUMNS,
    );
    return this.recorded(staff, 'bookings', stream, {
      search: filter.q === undefined ? undefined : true,
      theaterId: filter.theaterId,
      movieId: filter.movieId,
      status: filter.status,
      channel: filter.channel,
      method: filter.method,
      dateFrom: filter.dateFrom,
      dateTo: filter.dateTo,
      customerId: filter.customerId,
    });
  }

  /** `GET /admin/exports/customers.csv`: every row of `GET /admin/customers` with these filters. */
  async customers(staff: StaffPrincipal, filter: AdminCustomerFilter): Promise<ExportFile> {
    const batches = await this.adminCustomers.exportBatches(filter, this.options.batchSize);
    const stream = await csvStream(
      mapBatches(batches, (item) => this.customerResponses.item(item)),
      CUSTOMER_COLUMNS,
    );
    return this.recorded(staff, 'customers', stream, {
      search: filter.q === undefined ? undefined : true,
      status: filter.status,
    });
  }

  /** `GET /admin/exports/payments.csv`: every row of `GET /admin/payments` with these filters. */
  async payments(staff: StaffPrincipal, filter: TransactionFilter): Promise<ExportFile> {
    const batches = await this.paymentsReport.transactionBatches(filter, this.options.batchSize);
    const stream = await csvStream(
      mapBatches(batches, (row) => this.paymentResponses.transaction(row)),
      PAYMENT_COLUMNS,
    );
    return this.recorded(staff, 'payments', stream, {
      kind: filter.kind,
      method: filter.method,
      channel: filter.channel,
      status: filter.status,
      theaterId: filter.theaterId,
      dateFrom: filter.dateFrom,
      dateTo: filter.dateTo,
    });
  }

  /**
   * Records the download, then answers the file. If the record fails, the stream is destroyed
   * (its source stops) and nothing is sent.
   */
  private async recorded(
    staff: StaffPrincipal,
    dataset: ExportDataset,
    stream: Readable,
    filters: ExportFilters,
  ): Promise<ExportFile> {
    try {
      await this.transactions.run(() =>
        this.audit.record({
          actor: { kind: 'staff', id: staff.id },
          action: EXPORT_DOWNLOADED_ACTION,
          entity: { type: EXPORT_ENTITY, id: null },
          metadata: metadataOf(dataset, filters),
        }),
      );
    } catch (error) {
      stream.destroy();
      throw error;
    }
    return { filename: `maqady-${dataset}-${cinemaDateOf(this.clock.now())}.csv`, stream };
  }
}

/** The dataset and the filters that were given; absent filters are left out. */
function metadataOf(dataset: ExportDataset, filters: ExportFilters): ExportAuditMetadata {
  const given = Object.entries(filters).filter(
    (entry): entry is [string, AuditMetadataValue] => entry[1] !== undefined,
  );
  return { dataset, ...Object.fromEntries(given) };
}
