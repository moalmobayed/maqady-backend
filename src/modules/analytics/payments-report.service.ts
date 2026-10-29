import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { formatMoneyDisplay, money } from '../../common/money/money';
import { toPage, toPageRequest } from '../../common/pagination/cursor';
import { INVALID_CURSOR_MESSAGE } from '../../common/pagination/pagination.constants';
import type { Page, PageQueryInput } from '../../common/pagination/types';
import { Clock } from '../../common/time/clock';
import { addDays, cinemaDateOf, cinemaDayBounds } from '../../common/time/time';
import { SettlementService } from '../bookings/settlement.service';
import type { StaffRef } from '../bookings/types';
import { PaymentProvider } from '../payments/payment-provider';
import type { ChargeResult } from '../payments/types';
import { StaffService } from '../staff/staff.service';
import { DEFAULT_PERIOD_DAYS, MAX_PERIOD_DAYS, MISMATCH_LIST_LIMIT } from './analytics.constants';
import {
  failedCountsOf,
  reconciliationTotals,
  refundRateOf,
  theaterReconciliation,
  totalsByChannel,
  totalsByMethod,
  totalsOf,
} from './payments-report';
import { PaymentsReportRepository } from './payments-report.repository';
import { channelOfMethod, failureReasonOf, transactionStatusOf } from './transaction-status.sql';
import type {
  BalanceMismatchRow,
  OnlineCheckRow,
  OverRefundRow,
  PaymentPeriod,
  PaymentsSummary,
  PeriodQuery,
  ProviderCheckResult,
  ReconciliationMismatch,
  Transaction,
  TransactionFilter,
  TransactionRow,
} from './types';

/**
 * The admin Payments screen (PRD A8; design §11, §13.3), admins only: the transactions table and
 * the summary above it (the KPIs of a period and the reconciliation). Reads only; every due
 * payment is settled first in its own short transaction (`settleAllDue()`, design §7.5 "in a batch
 * before … the Payments screen"), so no row shows a stale Pending and the provider check never
 * compares a charge whose result is due.
 *
 * Exported for the Overview (U17) and the payments CSV (U19).
 */
@Injectable()
export class PaymentsReportService {
  constructor(
    private readonly report: PaymentsReportRepository,
    private readonly settlement: SettlementService,
    private readonly provider: PaymentProvider,
    private readonly staff: StaffService,
    private readonly clock: Clock,
  ) {}

  /**
   * `GET /admin/payments`: newest `occurredAt` first, cursor-paginated, `total` with the same
   * filters. One query for the page, one for the total, one for the staff names.
   */
  async transactions(filter: TransactionFilter, query: PageQueryInput): Promise<Page<Transaction>> {
    const request = toPageRequest(query, 'instant');
    if (request.after !== null && request.after.sortKey === null) {
      throw invalid('cursor', INVALID_CURSOR_MESSAGE);
    }
    if (
      filter.dateFrom !== undefined &&
      filter.dateTo !== undefined &&
      filter.dateFrom > filter.dateTo
    ) {
      throw invalid('dateTo', 'dateTo must be on or after dateFrom');
    }
    await this.settlement.settleAllDue();
    // One after the other: inside a transaction they would share one connection.
    const rows = await this.report.page(filter, request);
    const total = await this.report.count(filter);
    const pageRows = rows.slice(0, request.limit);
    const refs = await this.staffRefs(
      pageRows.flatMap((row) => [row.collected_by_staff_id, row.paid_out_by_staff_id]),
    );
    return toPage(
      rows,
      request,
      total,
      (row) => ({ sortKey: row.occurred_at.toISOString(), id: row.id }),
      (row) => toTransaction(row, refs),
    );
  }

  /**
   * The period of whole cinema days a summary query asks for (PRD A8 "Period picker (default last
   * 7 days)"): both dates inclusive; none is today and the 6 days before; `dateTo` alone starts 6
   * days before it; `dateFrom` alone ends today. `VALIDATION_FAILED` when `dateTo` is before
   * `dateFrom` or the period is longer than `MAX_PERIOD_DAYS`.
   */
  periodOf(query: PeriodQuery): PaymentPeriod {
    const today = cinemaDateOf(this.clock.now());
    const dateTo = query.dateTo ?? today;
    const dateFrom = query.dateFrom ?? addDays(dateTo, 1 - DEFAULT_PERIOD_DAYS);
    if (dateFrom > dateTo) throw invalid('dateTo', 'dateTo must be on or after dateFrom');
    if (addDays(dateFrom, MAX_PERIOD_DAYS) <= dateTo) {
      throw invalid('dateFrom', `the period may cover at most ${MAX_PERIOD_DAYS} days`);
    }
    return {
      dateFrom,
      dateTo,
      from: cinemaDayBounds(dateFrom).startsAt,
      to: cinemaDayBounds(dateTo).endsAt,
    };
  }

  /**
   * `GET /admin/payments/summary`: the period's KPIs on the money-moved basis (PRD "Collected":
   * succeeded charges minus succeeded refunds by `completed_at`), the four PRD cards, and the
   * reconciliation (by theater, the provider check, the ledger checks).
   */
  async summary(query: PeriodQuery): Promise<PaymentsSummary> {
    const period = this.periodOf(query);
    await this.settlement.settleAllDue();
    const now = this.clock.now();
    const cinemaDate = cinemaDateOf(now);
    const range = { from: period.from, to: period.to };
    const today = cinemaDayBounds(cinemaDate);
    // One after the other: inside a transaction they would share one connection.
    const aggregates = await this.report.periodAggregates(range);
    const todayAggregates = await this.report.periodAggregates({
      from: today.startsAt,
      to: today.endsAt,
    });
    const online = await this.report.onlineRowsCompletedBetween(range);
    const balances = await this.report.balanceMismatches(range, MISMATCH_LIST_LIMIT + 1);
    const overRefunds = await this.report.overRefunds(range, MISMATCH_LIST_LIMIT + 1);
    const providerCheck = await this.checkProvider(online);

    const totals = totalsOf(aggregates);
    const byChannel = totalsByChannel(aggregates);
    const channel = (name: 'online' | 'counter') =>
      byChannel.find((entry) => entry.channel === name)!;
    const byTheater = theaterReconciliation(aggregates);
    const mismatches = [
      ...balances.map(balanceMismatch),
      ...overRefunds.map(overRefundMismatch),
      ...providerCheck.mismatches,
    ];
    const truncated =
      balances.length > MISMATCH_LIST_LIMIT ||
      overRefunds.length > MISMATCH_LIST_LIMIT ||
      mismatches.length > MISMATCH_LIST_LIMIT;
    return {
      period,
      cinemaDate,
      serverTime: now,
      kpis: {
        collectedOnline: channel('online').net,
        collectedAtCounters: channel('counter').net,
        refunds: totals.refunds,
        refundRate: refundRateOf(totals),
        failedToday: failedCountsOf(todayAggregates).count,
      },
      totals,
      byChannel,
      byMethod: totalsByMethod(aggregates),
      failed: failedCountsOf(aggregates),
      reconciliation: {
        byTheater,
        totals: reconciliationTotals(byTheater),
        provider: providerCheck.provider,
        mismatches: mismatches.slice(0, MISMATCH_LIST_LIMIT),
        truncated,
        consistent: mismatches.length === 0,
      },
    };
  }

  /**
   * Asks the provider for each final online charge (`PaymentProvider.retrieve()`) and compares its
   * status with the ledger's. A reference the provider does not know is `provider_unknown`; a row
   * with none is `missing_provider_reference` (refunds included); a provider outage
   * (`SERVICE_UNAVAILABLE`), or anything that is not an `AppError`, fails the request.
   */
  private async checkProvider(rows: readonly OnlineCheckRow[]): Promise<ProviderCheckResult> {
    const mismatches: ReconciliationMismatch[] = [];
    let checkedCount = 0;
    let ledgerSucceeded = 0;
    let providerSucceeded = 0;
    for (const row of rows) {
      if (row.provider_reference === null) {
        mismatches.push(
          mismatchOf('missing_provider_reference', row, {
            ledgerStatus: row.status,
            message: `Payment ${row.id} of ${row.booking_reference} is an online ${row.kind} ${row.status} in the ledger with no provider reference.`,
          }),
        );
        continue;
      }
      if (row.kind !== 'charge') continue;
      checkedCount += 1;
      if (row.status === 'succeeded') ledgerSucceeded += row.amount;
      let result: ChargeResult;
      try {
        result = await this.provider.retrieve({ providerReference: row.provider_reference });
      } catch (error) {
        if (!(error instanceof AppError) || error.code === 'SERVICE_UNAVAILABLE') throw error;
        mismatches.push(
          mismatchOf('provider_unknown', row, {
            ledgerStatus: row.status,
            message: `Payment ${row.id} of ${row.booking_reference} is ${row.status} in the ledger, but the provider does not know its reference.`,
          }),
        );
        continue;
      }
      if (result.status === 'succeeded') providerSucceeded += row.amount;
      if (result.status !== row.status) {
        mismatches.push(
          mismatchOf('provider_status', row, {
            ledgerStatus: row.status,
            providerStatus: result.status,
            message: `Payment ${row.id} of ${row.booking_reference} is ${row.status} in the ledger but ${result.status} at the provider.`,
          }),
        );
      }
    }
    return {
      provider: {
        checkedCount,
        ledgerSucceeded: money(ledgerSucceeded),
        providerSucceeded: money(providerSucceeded),
        matched: mismatches.length === 0,
      },
      mismatches,
    };
  }

  private async staffRefs(ids: readonly (number | null)[]): Promise<ReadonlyMap<number, StaffRef>> {
    const wanted = [...new Set(ids.filter((id): id is number => id !== null))];
    if (wanted.length === 0) return new Map();
    const members = await this.staff.findByIds(wanted);
    return new Map(
      [...members.values()].map((member) => [
        member.id,
        { id: member.id, fullName: member.fullName },
      ]),
    );
  }
}

/** A row of the table, from its row and the staff names already read. */
export function toTransaction(
  row: TransactionRow,
  refs: ReadonlyMap<number, StaffRef>,
): Transaction {
  const isCharge = row.kind === 'charge';
  return {
    id: row.id,
    kind: row.kind,
    purpose: row.purpose,
    method: row.method,
    channel: channelOfMethod(row.method),
    status: transactionStatusOf({
      kind: row.kind,
      status: row.status,
      amount: row.amount,
      refundedAmount: row.refunded_amount,
    }),
    failureReason: failureReasonOf(row.status),
    ledgerStatus: row.status,
    amount: money(isCharge ? row.amount : -row.amount, row.currency),
    refundOfPaymentId: row.refund_of_payment_id,
    refundedAmount: isCharge ? money(row.refunded_amount, row.currency) : null,
    pendingRefundAmount: isCharge ? money(row.pending_refund_amount, row.currency) : null,
    booking: {
      reference: row.booking_reference,
      channel: row.booking_channel,
      contactName: row.contact_name,
    },
    theater: { id: row.theater_id, name: row.theater_name },
    card:
      row.card_brand !== null && row.card_last4 !== null
        ? { brand: row.card_brand, last4: row.card_last4 }
        : null,
    walletType: row.wallet_type,
    receiptReference: isCharge && row.method === 'card_terminal' ? row.provider_reference : null,
    collectedBy:
      row.collected_by_staff_id === null ? null : (refs.get(row.collected_by_staff_id) ?? null),
    paidOutAt: row.paid_out_at,
    paidOutBy:
      row.paid_out_by_staff_id === null ? null : (refs.get(row.paid_out_by_staff_id) ?? null),
    createdAt: row.created_at,
    completedAt: row.completed_at,
    occurredAt: row.occurred_at,
    cinemaDate: cinemaDateOf(row.occurred_at),
    actions: { markPaidOut: row.kind === 'refund' && row.status === 'pending' },
  };
}

function balanceMismatch(row: BalanceMismatchRow): ReconciliationMismatch {
  const expected = money(row.expected, row.currency);
  const actual = money(row.actual, row.currency);
  return {
    check: 'booking_balance',
    bookingReference: row.reference,
    paymentId: null,
    expectedAmount: expected,
    actualAmount: actual,
    ledgerStatus: null,
    providerStatus: null,
    message: `Booking ${row.reference} is ${row.status} and should hold ${formatSigned(expected.amount)}, but its succeeded charges minus refunds come to ${formatSigned(actual.amount)}.`,
  };
}

function overRefundMismatch(row: OverRefundRow): ReconciliationMismatch {
  return {
    check: 'over_refunded',
    bookingReference: row.reference,
    paymentId: row.payment_id,
    expectedAmount: money(row.amount, row.currency),
    actualAmount: money(row.refunded, row.currency),
    ledgerStatus: null,
    providerStatus: null,
    message: `Payment ${row.payment_id} of ${row.reference} took ${formatMoneyDisplay(money(row.amount, row.currency))}, but its refunds come to ${formatMoneyDisplay(money(row.refunded, row.currency))}.`,
  };
}

function mismatchOf(
  check: ReconciliationMismatch['check'],
  row: OnlineCheckRow,
  facts: Pick<ReconciliationMismatch, 'ledgerStatus' | 'message'> &
    Partial<Pick<ReconciliationMismatch, 'providerStatus'>>,
): ReconciliationMismatch {
  return {
    check,
    bookingReference: row.booking_reference,
    paymentId: row.id,
    expectedAmount: null,
    actualAmount: null,
    ledgerStatus: facts.ledgerStatus,
    providerStatus: facts.providerStatus ?? null,
    message: facts.message,
  };
}

/** `EGP 380`, or `-EGP 380` for money owed back. */
function formatSigned(amount: number): string {
  const display = formatMoneyDisplay(money(Math.abs(amount)));
  return amount < 0 ? `-${display}` : display;
}

function invalid(field: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', undefined, {
    fields: [{ field, messages: [message] }],
  });
}
