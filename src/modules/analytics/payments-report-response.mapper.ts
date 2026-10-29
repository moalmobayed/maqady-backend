import { Injectable } from '@nestjs/common';
import { MoneyResponse } from '../../common/money/dto/money-response.dto';
import type { Money } from '../../common/money/types';
import type { Page } from '../../common/pagination/types';
import { formatCairoIso } from '../../common/time/time';
import { StaffRefResponse } from '../bookings/dto/admin-payment.response';
import { NamedRefResponse } from '../bookings/dto/booking-showtime.response';
import { PaymentCardResponse } from '../bookings/dto/payment.response';
import type { StaffRef } from '../bookings/types';
import {
  AdminPaymentsSummaryResponse,
  ChannelTotalsResponse,
  FailedCountsResponse,
  MethodTotalsResponse,
  PaymentKpisResponse,
  PaymentPeriodResponse,
  PaymentTotalsResponse,
  ProviderCheckResponse,
  ReconciliationAmountsResponse,
  ReconciliationMismatchResponse,
  ReconciliationResponse,
  TheaterReconciliationResponse,
} from './dto/admin-payments-summary.response';
import {
  AdminTransactionPageResponse,
  AdminTransactionResponse,
  TransactionActionsResponse,
  TransactionBookingResponse,
} from './dto/admin-transaction.response';
import type {
  PaymentTotals,
  PaymentsSummary,
  ReconciliationAmounts,
  ReconciliationMismatch,
  TheaterRef,
  Transaction,
} from './types';

/** Response DTOs of the Payments screen (U16): times in Cairo ISO, money `{ amount, currency }`. */
@Injectable()
export class PaymentsReportResponseMapper {
  transactionPage(page: Page<Transaction>): InstanceType<typeof AdminTransactionPageResponse> {
    return Object.assign(new AdminTransactionPageResponse(), {
      items: page.items.map((item) => this.transaction(item)),
      nextCursor: page.nextCursor,
      total: page.total,
    });
  }

  transaction(row: Transaction): AdminTransactionResponse {
    return Object.assign(new AdminTransactionResponse(), {
      id: row.id,
      kind: row.kind,
      purpose: row.purpose,
      method: row.method,
      channel: row.channel,
      status: row.status,
      failureReason: row.failureReason,
      ledgerStatus: row.ledgerStatus,
      amount: toMoney(row.amount),
      refundOfPaymentId: row.refundOfPaymentId,
      refundedAmount: row.refundedAmount === null ? null : toMoney(row.refundedAmount),
      pendingRefundAmount:
        row.pendingRefundAmount === null ? null : toMoney(row.pendingRefundAmount),
      booking: Object.assign(new TransactionBookingResponse(), {
        reference: row.booking.reference,
        channel: row.booking.channel,
        contactName: row.booking.contactName,
      }),
      theater: toNamedRef(row.theater),
      card:
        row.card === null
          ? null
          : Object.assign(new PaymentCardResponse(), {
              brand: row.card.brand,
              last4: row.card.last4,
            }),
      walletType: row.walletType,
      receiptReference: row.receiptReference,
      collectedBy: toStaffRef(row.collectedBy),
      paidOutAt: row.paidOutAt === null ? null : formatCairoIso(row.paidOutAt),
      paidOutBy: toStaffRef(row.paidOutBy),
      createdAt: formatCairoIso(row.createdAt),
      completedAt: row.completedAt === null ? null : formatCairoIso(row.completedAt),
      occurredAt: formatCairoIso(row.occurredAt),
      cinemaDate: row.cinemaDate,
      actions: Object.assign(new TransactionActionsResponse(), {
        markPaidOut: row.actions.markPaidOut,
      }),
    });
  }

  summary(summary: PaymentsSummary): AdminPaymentsSummaryResponse {
    const { period, kpis, reconciliation } = summary;
    return Object.assign(new AdminPaymentsSummaryResponse(), {
      period: Object.assign(new PaymentPeriodResponse(), {
        dateFrom: period.dateFrom,
        dateTo: period.dateTo,
        from: formatCairoIso(period.from),
        to: formatCairoIso(period.to),
      }),
      cinemaDate: summary.cinemaDate,
      serverTime: formatCairoIso(summary.serverTime),
      kpis: Object.assign(new PaymentKpisResponse(), {
        collectedOnline: toMoney(kpis.collectedOnline),
        collectedAtCounters: toMoney(kpis.collectedAtCounters),
        refunds: toMoney(kpis.refunds),
        refundRate: kpis.refundRate,
        failedToday: kpis.failedToday,
      }),
      totals: Object.assign(new PaymentTotalsResponse(), totalsOf(summary.totals)),
      byChannel: summary.byChannel.map((entry) =>
        Object.assign(new ChannelTotalsResponse(), {
          channel: entry.channel,
          ...totalsOf(entry),
        }),
      ),
      byMethod: summary.byMethod.map((entry) =>
        Object.assign(new MethodTotalsResponse(), { method: entry.method, ...totalsOf(entry) }),
      ),
      failed: Object.assign(new FailedCountsResponse(), {
        count: summary.failed.count,
        declinedCount: summary.failed.declinedCount,
        cancelledCount: summary.failed.cancelledCount,
      }),
      reconciliation: Object.assign(new ReconciliationResponse(), {
        byTheater: reconciliation.byTheater.map((row) =>
          Object.assign(new TheaterReconciliationResponse(), {
            theater: toNamedRef(row.theater),
            ...amountsOf(row),
          }),
        ),
        totals: Object.assign(
          new ReconciliationAmountsResponse(),
          amountsOf(reconciliation.totals),
        ),
        provider: Object.assign(new ProviderCheckResponse(), {
          checkedCount: reconciliation.provider.checkedCount,
          ledgerSucceeded: toMoney(reconciliation.provider.ledgerSucceeded),
          providerSucceeded: toMoney(reconciliation.provider.providerSucceeded),
          matched: reconciliation.provider.matched,
        }),
        mismatches: reconciliation.mismatches.map(toMismatch),
        truncated: reconciliation.truncated,
        consistent: reconciliation.consistent,
      }),
    });
  }
}

function totalsOf(totals: PaymentTotals) {
  return {
    gross: toMoney(totals.gross),
    chargeCount: totals.chargeCount,
    refunds: toMoney(totals.refunds),
    refundCount: totals.refundCount,
    net: toMoney(totals.net),
  };
}

function amountsOf(amounts: ReconciliationAmounts) {
  return {
    online: toMoney(amounts.online),
    cash: toMoney(amounts.cash),
    cardTerminal: toMoney(amounts.cardTerminal),
    refunds: toMoney(amounts.refunds),
    net: toMoney(amounts.net),
  };
}

function toMismatch(mismatch: ReconciliationMismatch): ReconciliationMismatchResponse {
  return Object.assign(new ReconciliationMismatchResponse(), {
    check: mismatch.check,
    bookingReference: mismatch.bookingReference,
    paymentId: mismatch.paymentId,
    expectedAmount: mismatch.expectedAmount === null ? null : toMoney(mismatch.expectedAmount),
    actualAmount: mismatch.actualAmount === null ? null : toMoney(mismatch.actualAmount),
    ledgerStatus: mismatch.ledgerStatus,
    providerStatus: mismatch.providerStatus,
    message: mismatch.message,
  });
}

function toNamedRef(theater: TheaterRef): NamedRefResponse {
  return Object.assign(new NamedRefResponse(), { id: theater.id, name: theater.name });
}

function toStaffRef(ref: StaffRef | null): StaffRefResponse | null {
  return ref === null
    ? null
    : Object.assign(new StaffRefResponse(), { id: ref.id, fullName: ref.fullName });
}

function toMoney(value: Money): MoneyResponse {
  return Object.assign(new MoneyResponse(), { amount: value.amount, currency: value.currency });
}
