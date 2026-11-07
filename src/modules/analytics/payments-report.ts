import { money } from '../../common/money/money';
import { PAYMENT_METHODS } from '../payments/enums';
import { PAYMENT_CHANNELS } from './enums';
import { REFUND_RATE_DECIMALS } from './analytics.constants';
import { channelOfMethod } from './transaction-status.sql';
import type {
  ChannelTotals,
  FailedCounts,
  MethodTotals,
  PaymentTotals,
  PeriodAggregateRow,
  ReconciliationAmounts,
  TheaterReconciliation,
} from './types';

/**
 * Pure folds of a period's aggregate rows (one per theater, kind and method) into the Payments
 * screen's KPIs and reconciliation (U16), so every figure comes from the same rows and the
 * reconciliation's totals always equal the KPI totals.
 */

/** Succeeded charges, succeeded refunds and their difference over these rows. */
export function totalsOf(rows: readonly PeriodAggregateRow[]): PaymentTotals {
  let gross = 0;
  let chargeCount = 0;
  let refunds = 0;
  let refundCount = 0;
  for (const row of rows) {
    if (row.kind === 'charge') {
      gross += row.succeeded_amount;
      chargeCount += row.succeeded_count;
    } else {
      refunds += row.succeeded_amount;
      refundCount += row.succeeded_count;
    }
  }
  return {
    gross: money(gross),
    chargeCount,
    refunds: money(refunds),
    refundCount,
    net: money(gross - refunds),
  };
}

/** The totals of each method, every method listed in `PAYMENT_METHODS` order. */
export function totalsByMethod(rows: readonly PeriodAggregateRow[]): MethodTotals[] {
  return PAYMENT_METHODS.map((method) => ({
    method,
    ...totalsOf(rows.filter((row) => row.method === method)),
  }));
}

/** The totals of each channel: `online` (card, wallet), then `counter` (cash, card terminal). */
export function totalsByChannel(rows: readonly PeriodAggregateRow[]): ChannelTotals[] {
  return PAYMENT_CHANNELS.map((channel) => ({
    channel,
    ...totalsOf(rows.filter((row) => channelOfMethod(row.method) === channel)),
  }));
}

/** The charges shown `failed`: declined and cancelled (a closed wallet). */
export function failedCountsOf(rows: readonly PeriodAggregateRow[]): FailedCounts {
  let declinedCount = 0;
  let cancelledCount = 0;
  for (const row of rows) {
    if (row.kind !== 'charge') continue;
    declinedCount += row.declined_count;
    cancelledCount += row.cancelled_count;
  }
  return { count: declinedCount + cancelledCount, declinedCount, cancelledCount };
}

/**
 * "Reconciliation by theater: Online, Cash, Terminal, Refunds, Net" (PRD A8), one row per theater
 * that moved money, in the rows' order (theater name). A theater with only failed charges is left
 * out: it moved nothing.
 */
export function theaterReconciliation(
  rows: readonly PeriodAggregateRow[],
): TheaterReconciliation[] {
  const theaters = new Map<number, { name: string; rows: PeriodAggregateRow[] }>();
  for (const row of rows) {
    if (row.succeeded_count === 0) continue;
    const entry = theaters.get(row.theater_id) ?? { name: row.theater_name, rows: [] };
    entry.rows.push(row);
    theaters.set(row.theater_id, entry);
  }
  return [...theaters.entries()].map(([id, entry]) => ({
    theater: { id, name: entry.name },
    ...amountsOf(entry.rows),
  }));
}

/** The sum of the theater rows (equal to the KPI totals of the same aggregates). */
export function reconciliationTotals(
  theaters: readonly ReconciliationAmounts[],
): ReconciliationAmounts {
  const sum = (pick: (row: ReconciliationAmounts) => number) =>
    money(theaters.reduce((total, row) => total + pick(row), 0));
  return {
    online: sum((row) => row.online.amount),
    cash: sum((row) => row.cash.amount),
    cardTerminal: sum((row) => row.cardTerminal.amount),
    refunds: sum((row) => row.refunds.amount),
    net: sum((row) => row.net.amount),
  };
}

/**
 * Refunds ÷ money taken in the same period (design §13.3 "Refunds KPI"), rounded to
 * `REFUND_RATE_DECIMALS`; null when nothing was taken.
 */
export function refundRateOf(totals: PaymentTotals): number | null {
  if (totals.gross.amount === 0) return null;
  const scale = 10 ** REFUND_RATE_DECIMALS;
  return Math.round((totals.refunds.amount / totals.gross.amount) * scale) / scale;
}

function amountsOf(rows: readonly PeriodAggregateRow[]): ReconciliationAmounts {
  const charged = (methods: readonly string[]) =>
    rows
      .filter((row) => row.kind === 'charge' && methods.includes(row.method))
      .reduce((total, row) => total + row.succeeded_amount, 0);
  const online = charged(['card', 'wallet']);
  const cash = charged(['cash']);
  const cardTerminal = charged(['card_terminal']);
  const refunds = rows
    .filter((row) => row.kind === 'refund')
    .reduce((total, row) => total + row.succeeded_amount, 0);
  return {
    online: money(online),
    cash: money(cash),
    cardTerminal: money(cardTerminal),
    refunds: money(refunds),
    net: money(online + cash + cardTerminal - refunds),
  };
}
