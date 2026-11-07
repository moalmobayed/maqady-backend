import { transactionConditions } from '../../../../src/modules/analytics/transactions.sql';

describe('transactionConditions', () => {
  it('has no condition without filters', () => {
    expect(transactionConditions({})).toEqual([]);
  });

  it('binds every filter value, the channel as its methods', () => {
    expect(
      transactionConditions({ kind: 'refund', method: 'cash', theaterId: 7, channel: 'online' }),
    ).toEqual([
      { sql: 'p.kind = ?', bindings: ['refund'] },
      { sql: 'p.method = ?', bindings: ['cash'] },
      { sql: 'p.method IN (?, ?)', bindings: ['card', 'wallet'] },
      { sql: 's.theater_id = ?', bindings: [7] },
    ]);
    expect(transactionConditions({ channel: 'counter' })).toEqual([
      { sql: 'p.method IN (?, ?)', bindings: ['cash', 'card_terminal'] },
    ]);
  });

  it('reads the status through the shown-status predicate', () => {
    expect(transactionConditions({ status: 'failed' })).toEqual([
      { sql: "p.status IN ('declined', 'cancelled')", bindings: [] },
    ]);
  });

  it('bounds cinema dates of when the money moved, 06:00 to 06:00 Cairo time', () => {
    const [from, to] = transactionConditions({ dateFrom: '2026-10-10', dateTo: '2026-10-11' });
    expect(from).toEqual({
      sql: 'COALESCE(p.completed_at, p.created_at) >= ?',
      bindings: [new Date('2026-10-10T06:00:00+03:00')],
    });
    expect(to).toEqual({
      sql: 'COALESCE(p.completed_at, p.created_at) < ?',
      bindings: [new Date('2026-10-12T06:00:00+03:00')],
    });
  });

  it('follows the winter clock change: Cairo is +02:00 again on the last Friday of October', () => {
    // Summer time ends at midnight between Thursday 29 and Friday 30 October 2026.
    const [from, to] = transactionConditions({ dateFrom: '2026-10-29', dateTo: '2026-10-30' });
    expect(from!.bindings).toEqual([new Date('2026-10-29T06:00:00+03:00')]);
    expect(to!.bindings).toEqual([new Date('2026-10-31T06:00:00+02:00')]);
  });
});
