import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Admin } from '../../common/auth/access.decorators';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { AdminPaymentsSummaryResponse } from './dto/admin-payments-summary.response';
import { AdminPaymentsQuery, AdminPaymentsSummaryQuery } from './dto/admin-payments.query';
import { AdminTransactionPageResponse } from './dto/admin-transaction.response';
import { PaymentsReportResponseMapper } from './payments-report-response.mapper';
import { PaymentsReportService } from './payments-report.service';

/**
 * The admin Payments page (PRD A8; design §11, §13.3), admins only: the transactions table and
 * the KPIs and reconciliation above it. "Mark refund paid out" is `POST /admin/refunds/{id}/payouts`
 * and "open the booking" `GET /admin/bookings/{ref}` (U14).
 */
@ApiTags('Admin: payments')
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(
    private readonly report: PaymentsReportService,
    private readonly mapper: PaymentsReportResponseMapper,
  ) {}

  @Get()
  @Admin()
  @ApiOperation({
    summary: 'List transactions',
    description:
      "Admins only (a box office token is `FORBIDDEN`): the Payments table (PRD A8), one row per charge or refund, newest first by when the money moved (or, while it has not, when the row was written), cursor-paged with `total` under the same filters. Due slow payments are settled first, so nothing shows a stale `pending`.\n\n- `status` is what the screen shows: a charge is `pending` while processing, `succeeded`, `refunded` once its succeeded refunds reach its amount, or `failed` (`failureReason`: `declined`, or `cancelled` for a closed wallet); a refund is `pending` while a counter refund waits to be paid out, else `succeeded`. `ledgerStatus` is the stored status behind it.\n- A refund's `amount` is negative. A charge carries its refunds so far (`refundedAmount`) and those still waiting at the counter (`pendingRefundAmount`).\n- Filters combine: `kind`, `method`, `channel`, `status`, `theaterId`, `dateFrom` / `dateTo` (cinema dates of `occurredAt`, inclusive; the summary's period gives the same rows its KPIs count).\n- Drawer: open the booking with `GET /admin/bookings/{ref}`; when `actions.markPaidOut`, pay the refund out with `POST /admin/refunds/{id}/payouts`.",
  })
  @ApiOkResponse({
    type: AdminTransactionPageResponse,
    description: 'One page of transactions',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'SERVICE_UNAVAILABLE')
  async listTransactions(
    @Query() query: AdminPaymentsQuery,
  ): Promise<InstanceType<typeof AdminTransactionPageResponse>> {
    return this.mapper.transactionPage(
      await this.report.transactions(
        {
          kind: query.kind,
          method: query.method,
          channel: query.channel,
          status: query.status,
          theaterId: query.theaterId,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
        },
        { cursor: query.cursor, limit: query.limit },
      ),
    );
  }

  @Get('summary')
  @Admin()
  @ApiOperation({
    summary: 'KPIs and reconciliation of a period',
    description:
      "Admins only: the cards and the reconciliation above the Payments table (PRD A8) for a period of cinema days (06:00 to 06:00 Cairo time), by default the last 7 (today and the 6 before). Every figure is money moved, counted on the day it moved: succeeded charges (`gross`), succeeded refunds (`refunds`; a counter refund once paid out) and `net` (Collected). Due slow payments are settled first.\n\n- `kpis`: Collected online, Collected at counters, Refunds with `refundRate` (refunds ÷ money taken), Failed today (charges declined or closed at the wallet on today's cinema day).\n- `totals`, `byChannel`, `byMethod`: the same money by rail; `failed` counts the period's failed charges.\n- `reconciliation.byTheater`: Online, Cash, Terminal, Refunds and Net per theater; `totals` equals the KPI totals.\n- `reconciliation.provider`: every final online charge of the period retrieved from the payment provider, its succeeded total against the ledger's.\n- `reconciliation.mismatches`: records that do not add up (a booking whose charges minus refunds differ from what it should hold, a charge refunded beyond its amount, a status the provider disagrees with or does not know, an online row with no provider reference); `consistent` is true when there are none.\n- `dateTo` before `dateFrom`, or a period over 366 days: `VALIDATION_FAILED`.",
  })
  @ApiOkResponse({
    type: AdminPaymentsSummaryResponse,
    description: 'The KPIs and the reconciliation',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'SERVICE_UNAVAILABLE')
  async getPaymentsSummary(
    @Query() query: AdminPaymentsSummaryQuery,
  ): Promise<AdminPaymentsSummaryResponse> {
    return this.mapper.summary(
      await this.report.summary({ dateFrom: query.dateFrom, dateTo: query.dateTo }),
    );
  }
}
