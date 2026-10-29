import {
  failedCountsOf,
  reconciliationTotals,
  refundRateOf,
  theaterReconciliation,
  totalsByChannel,
  totalsByMethod,
  totalsOf,
} from '../../../../src/modules/analytics/payments-report';
import type { PeriodAggregateRow } from '../../../../src/modules/analytics/types';

const money = (amount: number) => ({ amount, currency: 'EGP' });

function row(overrides: Partial<PeriodAggregateRow>): PeriodAggregateRow {
  return {
    theater_id: 1,
    theater_name: 'Galaxy Maadi',
    kind: 'charge',
    method: 'card',
    succeeded_amount: 0,
    succeeded_count: 0,
    declined_count: 0,
    cancelled_count: 0,
    ...overrides,
  };
}

/** Two theaters: Galaxy Maadi (1) online and cash, Zamalek (2) a terminal sale and a closed wallet. */
const ROWS: PeriodAggregateRow[] = [
  row({ method: 'card', succeeded_amount: 57000, succeeded_count: 2, declined_count: 1 }),
  row({ method: 'cash', succeeded_amount: 15000, succeeded_count: 1 }),
  row({ kind: 'refund', method: 'card', succeeded_amount: 38000, succeeded_count: 1 }),
  row({ kind: 'refund', method: 'cash', succeeded_amount: 15000, succeeded_count: 1 }),
  row({
    theater_id: 2,
    theater_name: 'Zamalek Cinema',
    method: 'card_terminal',
    succeeded_amount: 23000,
    succeeded_count: 1,
  }),
  row({
    theater_id: 2,
    theater_name: 'Zamalek Cinema',
    method: 'wallet',
    cancelled_count: 1,
  }),
  row({ theater_id: 3, theater_name: 'Nothing moved', method: 'card', declined_count: 2 }),
];

describe('payments report folds', () => {
  it('totals succeeded charges and refunds, and their difference', () => {
    expect(totalsOf(ROWS)).toEqual({
      gross: money(95000),
      chargeCount: 4,
      refunds: money(53000),
      refundCount: 2,
      net: money(42000),
    });
    expect(totalsOf([])).toEqual({
      gross: money(0),
      chargeCount: 0,
      refunds: money(0),
      refundCount: 0,
      net: money(0),
    });
  });

  it('lists every method and both channels, even with nothing on them', () => {
    expect(totalsByMethod(ROWS).map((entry) => [entry.method, entry.net.amount])).toEqual([
      ['card', 19000],
      ['wallet', 0],
      ['cash', 0],
      ['card_terminal', 23000],
    ]);
    expect(totalsByChannel(ROWS)).toEqual([
      {
        channel: 'online',
        gross: money(57000),
        chargeCount: 2,
        refunds: money(38000),
        refundCount: 1,
        net: money(19000),
      },
      {
        channel: 'counter',
        gross: money(38000),
        chargeCount: 2,
        refunds: money(15000),
        refundCount: 1,
        net: money(23000),
      },
    ]);
  });

  it('counts the failed charges, declined and cancelled apart', () => {
    expect(failedCountsOf(ROWS)).toEqual({ count: 4, declinedCount: 3, cancelledCount: 1 });
  });

  it('reconciles each theater that moved money, the totals equal to the KPIs', () => {
    const theaters = theaterReconciliation(ROWS);
    expect(theaters).toEqual([
      {
        theater: { id: 1, name: 'Galaxy Maadi' },
        online: money(57000),
        cash: money(15000),
        cardTerminal: money(0),
        refunds: money(53000),
        net: money(19000),
      },
      {
        theater: { id: 2, name: 'Zamalek Cinema' },
        online: money(0),
        cash: money(0),
        cardTerminal: money(23000),
        refunds: money(0),
        net: money(23000),
      },
    ]);
    const totals = reconciliationTotals(theaters);
    expect(totals).toEqual({
      online: money(57000),
      cash: money(15000),
      cardTerminal: money(23000),
      refunds: money(53000),
      net: money(42000),
    });
    expect(totals.net).toEqual(totalsOf(ROWS).net);
  });

  it('gives refunds as a share of the money taken, rounded to 4 decimals, null on nothing', () => {
    expect(refundRateOf(totalsOf(ROWS))).toBe(0.5579);
    expect(refundRateOf(totalsOf([]))).toBeNull();
    expect(
      refundRateOf(
        totalsOf([row({ kind: 'refund', succeeded_amount: 15000, succeeded_count: 1 })]),
      ),
    ).toBeNull();
    expect(
      refundRateOf(
        totalsOf([
          row({ succeeded_amount: 10000, succeeded_count: 1 }),
          row({ kind: 'refund', succeeded_amount: 15000, succeeded_count: 1 }),
        ]),
      ),
    ).toBe(1.5);
  });
});
