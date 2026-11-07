import {
  channelOfMethod,
  failureReasonOf,
  transactionStatusOf,
  transactionStatusPredicate,
} from '../../../../src/modules/analytics/transaction-status.sql';
import type { TransactionStatusInput } from '../../../../src/modules/analytics/types';

const charge = (overrides: Partial<TransactionStatusInput>): TransactionStatusInput => ({
  kind: 'charge',
  status: 'succeeded',
  amount: 38000,
  refundedAmount: 0,
  ...overrides,
});

describe('transactionStatusOf (design §13.3)', () => {
  it.each([
    ['a processing charge', charge({ status: 'processing' }), 'pending'],
    ['a succeeded charge', charge({}), 'succeeded'],
    ['a partly refunded charge', charge({ refundedAmount: 4000 }), 'succeeded'],
    ['a charge refunded in full', charge({ refundedAmount: 38000 }), 'refunded'],
    ['a charge refunded beyond its amount', charge({ refundedAmount: 40000 }), 'refunded'],
    ['a declined charge', charge({ status: 'declined' }), 'failed'],
    ['a closed wallet', charge({ status: 'cancelled' }), 'failed'],
    ['a pending counter refund', charge({ kind: 'refund', status: 'pending' }), 'pending'],
    ['a succeeded refund', charge({ kind: 'refund', status: 'succeeded' }), 'succeeded'],
    [
      'a succeeded refund, whatever its own refunded sum',
      charge({ kind: 'refund', status: 'succeeded', refundedAmount: 99999 }),
      'succeeded',
    ],
  ])('shows %s as %s', (_name, input, shown) => {
    expect(transactionStatusOf(input)).toBe(shown);
  });

  it('gives the reason of a failed charge only', () => {
    expect(failureReasonOf('declined')).toBe('declined');
    expect(failureReasonOf('cancelled')).toBe('cancelled');
    for (const status of ['processing', 'succeeded', 'pending'] as const) {
      expect(failureReasonOf(status)).toBeNull();
    }
  });

  it('puts card and wallet online, cash and card terminal at the counter', () => {
    expect(channelOfMethod('card')).toBe('online');
    expect(channelOfMethod('wallet')).toBe('online');
    expect(channelOfMethod('cash')).toBe('counter');
    expect(channelOfMethod('card_terminal')).toBe('counter');
  });
});

describe('transactionStatusPredicate', () => {
  it('writes each shown status as SQL on the given alias, with nothing to bind', () => {
    expect(transactionStatusPredicate('pending', 'p')).toEqual({
      sql: "p.status IN ('processing', 'pending')",
      bindings: [],
    });
    expect(transactionStatusPredicate('failed', 'x')).toEqual({
      sql: "x.status IN ('declined', 'cancelled')",
      bindings: [],
    });
    const refunded = transactionStatusPredicate('refunded', 'p').sql;
    expect(refunded).toContain("p.kind = 'charge' AND p.status = 'succeeded'");
    expect(refunded).toContain(
      "WHERE fr.refund_of_payment_id = p.id AND fr.status = 'succeeded') >= p.amount",
    );
    const succeeded = transactionStatusPredicate('succeeded', 'p').sql;
    expect(succeeded).toMatch(/^\(p\.status = 'succeeded' AND NOT \(p\.kind = 'charge' AND /);
    // Succeeded and refunded split the succeeded rows on the same "fully refunded" sub-select.
    const fullyRefunded =
      /\(SELECT COALESCE\(SUM\(fr\.amount\), 0\) FROM payments AS fr [^)]*\) >= p\.amount/;
    expect(refunded.match(fullyRefunded)?.[0]).toBeDefined();
    expect(succeeded.match(fullyRefunded)?.[0]).toBe(refunded.match(fullyRefunded)?.[0]);
  });
});
