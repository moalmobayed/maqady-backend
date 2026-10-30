import { Controller, Get, Header, Logger, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Admin, CurrentPrincipal } from '../../common/auth/access.decorators';
import type { StaffPrincipal } from '../../common/auth/types';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { AdminOverviewQuery } from '../analytics/dto/admin-overview.query';
import { ExportBookingsQuery } from './dto/export-bookings.query';
import { ExportCustomersQuery } from './dto/export-customers.query';
import { ExportPaymentsQuery } from './dto/export-payments.query';
import { CSV_CONTENT_TYPE, EXPORT_CACHE_CONTROL } from './exports.constants';
import { ExportsService } from './exports.service';
import type { ExportFile } from './types';

const COMMON_RULES =
  'Admins only (a box office token is `FORBIDDEN`). Downloaded as a file (`Content-Disposition: attachment; filename="maqady-<dataset>-<cinema date>.csv"`), never cached (`Cache-Control: private, no-store`): fetch it with the `Authorization` header and save the response, no token ever goes in a URL.\n\n- CSV: UTF-8 with a byte-order mark (Arabic opens correctly in Excel), CRLF line ends, a header row, a field quoted when it holds a comma, a quote or a line break.\n- **Formula-safe**: any text cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with `\'`, so a spreadsheet shows it as text instead of running it (a phone such as `+201012345678` reads `\'+201012345678`). Numbers are plain numbers.\n- Money is in Egyptian pounds as a decimal number (`190`, `19.5`), with its currency in a column; times are Cairo ISO with their offset, as the API answers them; yes / no for flags; an empty cell for none.\n- Streamed: rows are read in batches as the download proceeds, so a file of any size starts at once. If the server fails part-way, the connection is cut, so the download fails instead of saving a short file.\n- Recorded in the activity log (`export.downloaded`, item type `export`) with the filters given, because the file holds personal data; a search text is recorded only as `search: true`. A refused request (`VALIDATION_FAILED`) records nothing.';

const CSV_RESPONSE = {
  schema: { type: 'string' as const },
};

/**
 * The admin CSV exports (PRD "CSV exports"; design §11, §13.4): Overview (current view), Bookings
 * and Customers (current filters), Payments (chosen period). Each takes its screen's query
 * parameters without `cursor` and `limit`, and answers the whole filtered list.
 */
@ApiTags('Admin: exports')
@Controller('admin/exports')
export class ExportsController {
  private readonly logger = new Logger(ExportsController.name);

  constructor(private readonly exports: ExportsService) {}

  @Get('overview.csv')
  @Admin()
  @Header('Cache-Control', EXPORT_CACHE_CONTROL)
  @ApiOperation({
    summary: 'Export the Overview as CSV',
    description: `"Export CSV of the current view" on the Overview (PRD A1): the figures \`GET /admin/overview\` answers for the same \`period\` or \`dateFrom\` / \`dateTo\` and \`theaterId\`, one row per figure.\n\n- Columns: Section, Cinema date, Subject ID, Subject, Metric, Unit (\`EGP\`, \`count\`, \`ratio\`, \`date\`, \`text\`), Value, Previous, Change.\n- Sections, in the screen's order: \`period\` (the dates, the comparison, when it was generated), \`kpis\` (with Previous and Change), \`by_theater\` (revenue with its previous and change, online, counter, average ticket, tickets, seats, occupancy, showtimes), \`by_hall\` (one theater only), \`payment_methods\`, \`top_movies\`, \`heatmap\` (Subject ID the ISO weekday of the cinema date, 1 Monday to 7 Sunday; Subject the start-time slot), \`revenue_trend\` (all theaters, then each, by cinema date) and \`tonight\` (Subject ID the showtime).\n- Ratios are as the API answers them: \`0.4567\` is 45.67%.\n- The same rules as \`GET /admin/overview\`: either a preset or dates, at most 366 days, an unknown \`theaterId\` is \`NOT_FOUND\`; due slow payments are settled first.\n\n${COMMON_RULES}`,
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'The Overview as CSV',
    content: {
      'text/csv': {
        ...CSV_RESPONSE,
        example:
          'Section,Cinema date,Subject ID,Subject,Metric,Unit,Value,Previous,Change\r\nkpis,,,All theaters,revenue,EGP,1900,1500,0.2667\r\n',
      },
    },
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'SERVICE_UNAVAILABLE')
  async exportOverview(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Query() query: AdminOverviewQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return this.download(
      await this.exports.overview(principal, {
        period: query.period,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        theaterId: query.theaterId,
      }),
      response,
    );
  }

  @Get('bookings.csv')
  @Admin()
  @Header('Cache-Control', EXPORT_CACHE_CONTROL)
  @ApiOperation({
    summary: 'Export bookings as CSV',
    description: `"Export" on the Bookings table (PRD A6, "Bookings (current filters)"): every booking \`GET /admin/bookings\` lists with the same filters (\`q\`, \`theaterId\`, \`movieId\`, \`status\`, \`channel\`, \`method\`, \`dateFrom\` / \`dateTo\`, \`customerId\`), every page, in its order (newest first), each row the list's row.\n\n- Columns: Reference, Status, Payment status, Channel, Owner, Contact name, Contact email, Contact phone, Movie, Theater, Hall, Starts at, Cinema date, Seats (labels separated by spaces), Seat count, Total, Currency, Payment method, Card brand, Card last 4, Wallet, Receipt reference, Created at, Confirmed at, Checked in at.\n- Statuses are decided by the clock at the moment the export starts, after due slow payments are settled, as the list's are.\n- The same validation as the list: \`dateTo\` before \`dateFrom\` or a malformed filter is \`VALIDATION_FAILED\`; \`cursor\` and \`limit\` are refused.\n\n${COMMON_RULES}`,
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'The bookings as CSV',
    content: {
      'text/csv': {
        ...CSV_RESPONSE,
        example:
          "Reference,Status,Payment status,Channel,Owner,Contact name,Contact email,Contact phone,Movie,Theater,Hall,Starts at,Cinema date,Seats,Seat count,Total,Currency,Payment method,Card brand,Card last 4,Wallet,Receipt reference,Created at,Confirmed at,Checked in at\r\nMQ-7K3P9Q,confirmed,succeeded,online,customer,Nadia Farouk,nadia@example.com,'+201012345678,The Nile Light,Zawya Downtown,Hall 1,2026-10-16T19:30:00+03:00,2026-10-16,B2 B3,2,380,EGP,card,visa,4242,,,2026-10-10T10:00:00+03:00,2026-10-10T10:00:05+03:00,\r\n",
      },
    },
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'SERVICE_UNAVAILABLE')
  async exportBookings(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Query() query: ExportBookingsQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return this.download(
      await this.exports.bookings(principal, {
        q: query.q,
        theaterId: query.theaterId,
        movieId: query.movieId,
        status: query.status,
        channel: query.channel,
        method: query.method,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        customerId: query.customerId,
      }),
      response,
    );
  }

  @Get('customers.csv')
  @Admin()
  @Header('Cache-Control', EXPORT_CACHE_CONTROL)
  @ApiOperation({
    summary: 'Export customers as CSV',
    description: `"Export (Admin)" on the Customers table (PRD A7, "Customers (current filters)"): every customer \`GET /admin/customers\` lists with the same \`q\` and \`status\`, every page, newest account first, each row the list's row with its numbers. Deleted (anonymised) accounts are never in it.\n\n- Columns: ID, Full name, Email, Phone, Status, Email verified, Email verified at, Joined at, Last sign-in at, Updated at, Bookings, Spent, Currency, No-shows, Last booking at.\n- Due slow payments are settled first, so the numbers match the Bookings screen.\n- \`cursor\` and \`limit\` are refused.\n\n${COMMON_RULES}`,
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'The customers as CSV',
    content: {
      'text/csv': {
        ...CSV_RESPONSE,
        example:
          "ID,Full name,Email,Phone,Status,Email verified,Email verified at,Joined at,Last sign-in at,Updated at,Bookings,Spent,Currency,No-shows,Last booking at\r\n42,Layla Hassan,layla@example.com,'+201012345678,active,yes,2026-09-01T12:00:00+03:00,2026-09-01T11:58:00+03:00,2026-10-10T09:00:00+03:00,2026-10-10T09:00:00+03:00,3,1140,EGP,1,2026-10-10T10:00:00+03:00\r\n",
      },
    },
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'SERVICE_UNAVAILABLE')
  async exportCustomers(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Query() query: ExportCustomersQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return this.download(
      await this.exports.customers(principal, {
        ...(query.q !== undefined ? { q: query.q } : {}),
        ...(query.status !== undefined ? { status: query.status } : {}),
      }),
      response,
    );
  }

  @Get('payments.csv')
  @Admin()
  @Header('Cache-Control', EXPORT_CACHE_CONTROL)
  @ApiOperation({
    summary: 'Export transactions as CSV',
    description: `"Export for accounting" on the Payments page (PRD A8, "Payments for accounting (chosen period)"): every charge and refund \`GET /admin/payments\` lists with the same filters (\`kind\`, \`method\`, \`channel\`, \`status\`, \`theaterId\`, \`dateFrom\` / \`dateTo\`: cinema dates of when the money moved, inclusive), every page, newest first, each row the table's row.\n\n- Columns: ID, Occurred at, Cinema date, Kind, Purpose, Method, Channel, Status (as the screen shows it), Failure reason, Ledger status, Amount (negative for a refund), Currency, Refund of payment, Refunded amount, Pending refund amount, Booking reference, Booking channel, Contact name, Theater ID, Theater, Card brand, Card last 4, Wallet, Receipt reference, Collected by, Paid out at, Paid out by, Created at, Completed at.\n- Due slow payments are settled first, so nothing shows a stale \`pending\`.\n- \`dateTo\` before \`dateFrom\` or a malformed filter is \`VALIDATION_FAILED\`; \`cursor\` and \`limit\` are refused.\n\n${COMMON_RULES}`,
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'The transactions as CSV',
    content: {
      'text/csv': {
        ...CSV_RESPONSE,
        example:
          'ID,Occurred at,Cinema date,Kind,Purpose,Method,Channel,Status,Failure reason,Ledger status,Amount,Currency,Refund of payment,Refunded amount,Pending refund amount,Booking reference,Booking channel,Contact name,Theater ID,Theater,Card brand,Card last 4,Wallet,Receipt reference,Collected by,Paid out at,Paid out by,Created at,Completed at\r\n12,2026-10-10T10:02:00+03:00,2026-10-10,refund,cancellation,card,online,succeeded,,succeeded,-380,EGP,7,,,MQ-7K3P9Q,online,Nadia Farouk,1,Zawya Downtown,visa,4242,,,,,,2026-10-10T10:02:00+03:00,2026-10-10T10:02:00+03:00\r\n',
      },
    },
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'SERVICE_UNAVAILABLE')
  async exportPayments(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Query() query: ExportPaymentsQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    return this.download(
      await this.exports.payments(principal, {
        kind: query.kind,
        method: query.method,
        channel: query.channel,
        status: query.status,
        theaterId: query.theaterId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      }),
      response,
    );
  }

  /**
   * The file as the response. A client that goes away destroys the stream, which stops its
   * reading; a failure after the first byte cuts the connection (the status is already sent), so
   * the client never keeps a short file that looks complete. Logged without the data.
   */
  private download(file: ExportFile, response: Response): StreamableFile {
    response.on('close', () => {
      if (!file.stream.readableEnded) file.stream.destroy();
    });
    return new StreamableFile(file.stream, {
      type: CSV_CONTENT_TYPE,
      disposition: `attachment; filename="${file.filename}"`,
    })
      .setErrorHandler(() => {
        response.destroy();
      })
      .setErrorLogger((error) => {
        this.logger.error({ err: error }, 'A CSV export failed after its first byte');
      });
  }
}
