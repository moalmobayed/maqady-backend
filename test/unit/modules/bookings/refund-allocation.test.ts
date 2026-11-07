import { money } from '../../../../src/common/money/money';
import type { LedgerEntry } from '../../../../src/modules/payments/types';
import {
  allocateRefund,
  refundableCharges,
  refundEverything,
} from '../../../../src/modules/bookings/refund-allocation';

const T0 = new Date('2026-10-10T10:00:00Z');
const T1 = new Date('2026-10-10T11:00:00Z');

function entry(overrides: Partial<LedgerEntry> & { id: number }): LedgerEntry {
  return {
    bookingId: 100,
    kind: 'charge',
    purpose: 'sale',
    method: 'card',
    status: 'succeeded',
    amount: money(30000),
    refundOfPaymentId: null,
    providerReference: 'sim.sim_card_visa.1.0123456789abcdef',
    card: null,
    walletType: null,
    settlesAt: null,
    completedAt: T0,
    createdAt: T0,
    collectedByStaffId: null,
    paidOutAt: null,
    paidOutByStaffId: null,
    refundable: money(30000),
    ...overrides,
  };
}

describe('refundableCharges', () => {
  it('keeps succeeded charges with money left, newest first, ties by the higher id', () => {
    const sale = entry({ id: 1 });
    const difference = entry({
      id: 3,
      purpose: 'edit_difference',
      method: 'cash',
      providerReference: null,
      amount: money(8000),
      refundable: money(8000),
      createdAt: T1,
    });
    const sameInstant = entry({ id: 2, createdAt: T0 });
    const declined = entry({ id: 4, status: 'declined', refundable: null });
    const spent = entry({ id: 5, refundable: money(0) });
    const refund = entry({ id: 6, kind: 'refund', refundOfPaymentId: 1, refundable: null });
    expect(
      refundableCharges([sale, difference, sameInstant, declined, spent, refund]).map((e) => e.id),
    ).toEqual([3, 2, 1]);
  });
});

describe('allocateRefund', () => {
  const card = entry({ id: 1, amount: money(38000), refundable: money(38000) });
  const cash = entry({
    id: 2,
    method: 'cash',
    providerReference: null,
    purpose: 'edit_difference',
    amount: money(8000),
    refundable: money(8000),
    createdAt: T1,
  });

  it('takes a partial amount from the newest charge only', () => {
    expect(allocateRefund([card, cash], money(5000))).toEqual([
      { charge: cash, amount: money(5000) },
    ]);
  });

  it('spills over to older charges, each up to what is left of it', () => {
    expect(allocateRefund([card, cash], money(10000))).toEqual([
      { charge: cash, amount: money(8000) },
      { charge: card, amount: money(2000) },
    ]);
  });

  it('refunds exactly everything when asked for the whole net amount', () => {
    expect(allocateRefund([card, cash], money(46000))).toEqual([
      { charge: cash, amount: money(8000) },
      { charge: card, amount: money(38000) },
    ]);
  });

  it('refuses more than the charges hold', () => {
    expect(() => allocateRefund([card], money(38001))).toThrow(
      expect.objectContaining({ code: 'INTERNAL' }),
    );
  });

  it('plans nothing for nothing', () => {
    expect(allocateRefund([card], money(0))).toEqual([]);
  });
});

describe('refundEverything', () => {
  it('refunds what is left of every charge, after a partial refund too', () => {
    const card = entry({ id: 1, amount: money(38000), refundable: money(30000) });
    const cash = entry({ id: 2, method: 'cash', refundable: money(8000), createdAt: T1 });
    expect(refundEverything([card, cash])).toEqual([
      { charge: cash, amount: money(8000) },
      { charge: card, amount: money(30000) },
    ]);
  });
});
