import type { TransactionContext } from '../../../../src/common/database/transaction-context';
import { money } from '../../../../src/common/money/money';
import type { PaymentsRepository } from '../../../../src/modules/payments/payments.repository';
import { PaymentsService, toPayment } from '../../../../src/modules/payments/payments.service';
import type { NewPaymentRow, PaymentRow } from '../../../../src/modules/payments/types';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-16T16:00:00Z');

function paymentRow(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: 7,
    booking_id: 100,
    kind: 'charge',
    purpose: 'sale',
    method: 'card',
    status: 'processing',
    amount: 38000,
    currency: 'EGP',
    refund_of_payment_id: null,
    provider_idempotency_key: 'MQ-7K3P9Q-c1',
    provider_reference: null,
    card_brand: null,
    card_last4: null,
    wallet_type: null,
    settles_at: null,
    completed_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

describe('PaymentsService', () => {
  const calls: string[] = [];
  let repository: Record<
    | 'insert'
    | 'insertCounterCharge'
    | 'recordResult'
    | 'countOf'
    | 'countsOf'
    | 'insertMany'
    | 'finishProcessing'
    | 'due',
    jest.Mock
  >;
  let provider: Record<'charge' | 'retrieve' | 'refund', jest.Mock>;
  let active: boolean;
  let service: PaymentsService;

  beforeEach(() => {
    calls.length = 0;
    active = true;
    repository = {
      insert: jest.fn((row: NewPaymentRow) => {
        calls.push(`insert ${row.status}`);
        return Promise.resolve(paymentRow({ ...row, id: 7 }));
      }),
      insertCounterCharge: jest.fn((row: Partial<PaymentRow>) =>
        Promise.resolve(paymentRow({ ...row, id: 9 })),
      ),
      recordResult: jest.fn((id: number, columns: Partial<PaymentRow>) => {
        calls.push('record');
        return Promise.resolve(paymentRow({ id, ...columns }));
      }),
      countOf: jest.fn().mockResolvedValue(1),
      countsOf: jest.fn().mockResolvedValue([{ booking_id: 100, count: 0 }]),
      insertMany: jest.fn((rows: NewPaymentRow[]) =>
        Promise.resolve(rows.map((row, index) => paymentRow({ ...row, id: 50 + index }))),
      ),
      finishProcessing: jest.fn().mockResolvedValue([]),
      due: jest.fn().mockResolvedValue([]),
    };
    provider = {
      charge: jest.fn(() => {
        calls.push('provider');
        return Promise.resolve({
          status: 'succeeded',
          providerReference: 'sim.sim_card_visa.1.0123456789abcdef',
          settlesAt: null,
          card: { brand: 'visa', last4: '4242' },
          walletType: null,
        });
      }),
      retrieve: jest.fn(),
      refund: jest.fn().mockResolvedValue({ status: 'succeeded', providerReference: 'simr.1' }),
    };
    service = new PaymentsService(
      repository as unknown as PaymentsRepository,
      provider,
      { isActive: () => active } as unknown as TransactionContext,
      new TestClock(NOW),
    );
  });

  it('inserts the charge as processing before the provider is called, with the next attempt key', async () => {
    const payment = await service.chargeOnline({
      bookingId: 100,
      reference: 'MQ-7K3P9Q',
      amount: money(38000),
      method: 'card',
      token: 'sim_card_visa',
    });
    expect(calls).toEqual(['insert processing', 'provider', 'record']);
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ provider_idempotency_key: 'MQ-7K3P9Q-c2', status: 'processing' }),
    );
    expect(provider.charge).toHaveBeenCalledWith({
      amount: money(38000),
      method: 'card',
      token: 'sim_card_visa',
      idempotencyKey: 'MQ-7K3P9Q-c2',
    });
    expect(repository.recordResult).toHaveBeenCalledWith(7, {
      status: 'succeeded',
      provider_reference: 'sim.sim_card_visa.1.0123456789abcdef',
      card_brand: 'visa',
      card_last4: '4242',
      wallet_type: null,
      settles_at: null,
      completed_at: NOW,
      updated_at: NOW,
    });
    expect(payment).toMatchObject({ status: 'succeeded', card: { brand: 'visa', last4: '4242' } });
  });

  it('records a processing result with its settlement time and no completion', async () => {
    const settlesAt = new Date(NOW.getTime() + 10_000);
    provider.charge.mockResolvedValue({
      status: 'processing',
      providerReference: 'sim.sim_card_slow.1.0123456789abcdef',
      settlesAt,
      card: { brand: 'visa', last4: '3184' },
      walletType: null,
    });
    await service.chargeOnline({
      bookingId: 100,
      reference: 'MQ-7K3P9Q',
      amount: money(38000),
      method: 'card',
      token: 'sim_card_slow',
    });
    expect(repository.recordResult).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ status: 'processing', settles_at: settlesAt, completed_at: null }),
    );
  });

  it('finishes only final results, and returns only the charges the update won', async () => {
    repository.finishProcessing.mockResolvedValue([paymentRow({ status: 'succeeded' })]);
    const finished = await service.finishProcessing([
      {
        paymentId: 7,
        result: {
          status: 'succeeded',
          providerReference: 'a',
          settlesAt: null,
          card: null,
          walletType: null,
        },
      },
      {
        paymentId: 8,
        result: {
          status: 'processing',
          providerReference: 'b',
          settlesAt: NOW,
          card: null,
          walletType: null,
        },
      },
    ]);
    expect(repository.finishProcessing).toHaveBeenCalledWith([{ id: 7, status: 'succeeded' }], NOW);
    expect(finished.map((payment) => payment.id)).toEqual([7]);
  });

  it('refunds succeeded online charges in full, numbering the refunds of each booking', async () => {
    const charge = toPayment(
      paymentRow({ status: 'succeeded', provider_reference: 'sim.x', completed_at: NOW }),
    );
    const refunds = await service.refundOnline([
      { charge, reference: 'MQ-7K3P9Q' },
      { charge: { ...charge, id: 9 }, reference: 'MQ-7K3P9Q' },
    ]);
    expect(provider.refund.mock.calls.map(([request]) => request as unknown)).toEqual([
      { chargeReference: 'sim.x', amount: money(38000), idempotencyKey: 'MQ-7K3P9Q-r1' },
      { chargeReference: 'sim.x', amount: money(38000), idempotencyKey: 'MQ-7K3P9Q-r2' },
    ]);
    expect(refunds.map((refund) => [refund.kind, refund.status, refund.refundOfPaymentId])).toEqual(
      [
        ['refund', 'succeeded', 7],
        ['refund', 'succeeded', 9],
      ],
    );
    await expect(
      service.refundOnline([{ charge: { ...charge, status: 'declined' }, reference: 'MQ-7K3P9Q' }]),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  describe('recordCounterCharge (U13)', () => {
    it('records money taken at the counter as succeeded at once, with no provider call', async () => {
      const payment = await service.recordCounterCharge({
        bookingId: 100,
        amount: money(38000),
        method: 'card_terminal',
        receiptReference: 'TRX-0042817',
        purpose: 'sale',
        collectedByStaffId: 7,
      });
      expect(repository.insertCounterCharge).toHaveBeenCalledWith({
        booking_id: 100,
        kind: 'charge',
        purpose: 'sale',
        method: 'card_terminal',
        status: 'succeeded',
        amount: 38000,
        currency: 'EGP',
        provider_reference: 'TRX-0042817',
        collected_by_staff_id: 7,
        completed_at: NOW,
        created_at: NOW,
        updated_at: NOW,
      });
      expect(provider.charge).not.toHaveBeenCalled();
      expect(payment).toMatchObject({
        id: 9,
        method: 'card_terminal',
        status: 'succeeded',
        providerReference: 'TRX-0042817',
        completedAt: NOW,
      });
    });

    it('never stores a receipt reference for cash, and refuses a terminal payment without one', async () => {
      await service.recordCounterCharge({
        bookingId: 100,
        amount: money(15000),
        method: 'cash',
        receiptReference: 'ignored',
        purpose: 'sale',
        collectedByStaffId: 7,
      });
      expect(repository.insertCounterCharge).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'cash', provider_reference: null }),
      );
      await expect(
        service.recordCounterCharge({
          bookingId: 100,
          amount: money(15000),
          method: 'card_terminal',
          receiptReference: null,
          purpose: 'sale',
          collectedByStaffId: 7,
        }),
      ).rejects.toMatchObject({ code: 'INTERNAL' });
      active = false;
      await expect(
        service.recordCounterCharge({
          bookingId: 100,
          amount: money(15000),
          method: 'cash',
          receiptReference: null,
          purpose: 'sale',
          collectedByStaffId: 7,
        }),
      ).rejects.toMatchObject({ code: 'INTERNAL' });
      expect(repository.insertCounterCharge).toHaveBeenCalledTimes(1);
    });
  });

  it('refuses every write outside a transaction (INTERNAL)', async () => {
    active = false;
    await expect(
      service.chargeOnline({
        bookingId: 100,
        reference: 'MQ-7K3P9Q',
        amount: money(1),
        method: 'card',
        token: 'sim_card_visa',
      }),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
    await expect(service.finishProcessing([])).rejects.toMatchObject({ code: 'INTERNAL' });
    await expect(service.refundOnline([])).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('lists due charges that have a provider reference, with their settlement time', async () => {
    const settlesAt = new Date(NOW.getTime() - 1);
    repository.due.mockResolvedValue([
      paymentRow({
        id: 1,
        provider_reference: 'sim.a',
        status: 'processing',
        settles_at: settlesAt,
      }),
      paymentRow({ id: 2, provider_reference: null, status: 'processing', settles_at: settlesAt }),
    ]);
    expect(await service.due(100)).toEqual([
      { paymentId: 1, bookingId: 100, providerReference: 'sim.a', settlesAt },
    ]);
    expect(repository.due).toHaveBeenCalledWith(NOW, 100, undefined);
  });

  it('passes the cursor of the previous page on to the repository', async () => {
    repository.due.mockResolvedValue([]);
    const after = { settlesAt: NOW, paymentId: 7 };
    await service.due(100, after);
    expect(repository.due).toHaveBeenCalledWith(NOW, 100, after);
  });
});

describe('PaymentsService refunds per charge and payouts (U14)', () => {
  let repository: Record<
    | 'countsOf'
    | 'insertRefunds'
    | 'ledgerOf'
    | 'findLedgerEntry'
    | 'markPaidOut'
    | 'moneyMovedBetween'
    | 'refundTotalOf',
    jest.Mock
  >;
  let provider: Record<'charge' | 'retrieve' | 'refund', jest.Mock>;
  let active: boolean;
  let service: PaymentsService;

  const ledgerRow = (overrides: Partial<PaymentRow> & Record<string, unknown> = {}) => ({
    ...paymentRow({
      status: 'succeeded',
      provider_reference: 'sim.sim_card_visa.1.0123456789abcdef',
      completed_at: NOW,
    }),
    collected_by_staff_id: null,
    paid_out_at: null,
    paid_out_by_staff_id: null,
    refunded_amount: 0,
    ...overrides,
  });

  beforeEach(() => {
    active = true;
    repository = {
      countsOf: jest.fn().mockResolvedValue([{ booking_id: 100, count: 1 }]),
      insertRefunds: jest.fn((rows: Record<string, unknown>[]) =>
        Promise.resolve(rows.map((row, index) => ledgerRow({ ...row, id: 60 + index }))),
      ),
      ledgerOf: jest.fn().mockResolvedValue([]),
      findLedgerEntry: jest.fn().mockResolvedValue(undefined),
      markPaidOut: jest.fn().mockResolvedValue(undefined),
      moneyMovedBetween: jest.fn().mockResolvedValue({ collected: -1500, declined: 2 }),
      refundTotalOf: jest.fn().mockResolvedValue(30000),
    };
    provider = {
      charge: jest.fn(),
      retrieve: jest.fn(),
      refund: jest.fn().mockResolvedValue({ status: 'succeeded', providerReference: 'simr.abc' }),
    };
    service = new PaymentsService(
      repository as unknown as PaymentsRepository,
      provider,
      { isActive: () => active } as unknown as TransactionContext,
      new TestClock(NOW),
    );
  });

  it('reads a charge’s remaining refundable amount from the refunds naming it', async () => {
    repository.ledgerOf.mockResolvedValue([
      ledgerRow({ refunded_amount: 8000 }),
      ledgerRow({ id: 8, kind: 'refund', refund_of_payment_id: 7, amount: 8000 }),
      ledgerRow({ id: 9, status: 'declined' }),
    ]);
    const [charge, refund, declined] = await service.ledgerOf([100]);
    expect(charge?.refundable).toEqual(money(30000));
    expect(refund?.refundable).toBeNull();
    expect(declined?.refundable).toBeNull();
  });

  it('refunds online through the provider and at the counter as pending, in one insert', async () => {
    const card = {
      ...toPayment(
        paymentRow({
          status: 'succeeded',
          provider_reference: 'sim.sim_card_visa.1.0123456789abcdef',
        }),
      ),
      collectedByStaffId: null,
      paidOutAt: null,
      paidOutByStaffId: null,
      refundable: money(38000),
    };
    const cash = {
      ...toPayment(
        paymentRow({
          id: 8,
          method: 'cash',
          status: 'succeeded',
          provider_idempotency_key: null,
          amount: 8000,
        }),
      ),
      collectedByStaffId: 5,
      paidOutAt: null,
      paidOutByStaffId: null,
      refundable: money(8000),
    };
    const refunds = await service.refund(
      [
        { charge: card, amount: money(30000), reference: 'MQ-7K3P9Q' },
        { charge: cash, amount: money(8000), reference: 'MQ-7K3P9Q' },
      ],
      'edit_difference',
    );
    expect(provider.refund).toHaveBeenCalledTimes(1);
    expect(provider.refund).toHaveBeenCalledWith({
      chargeReference: 'sim.sim_card_visa.1.0123456789abcdef',
      amount: money(30000),
      idempotencyKey: 'MQ-7K3P9Q-r2',
    });
    const [rows] = repository.insertRefunds.mock.calls[0] as [Record<string, unknown>[]];
    expect(rows).toEqual([
      expect.objectContaining({
        kind: 'refund',
        purpose: 'edit_difference',
        method: 'card',
        status: 'succeeded',
        amount: 30000,
        refund_of_payment_id: 7,
        provider_idempotency_key: 'MQ-7K3P9Q-r2',
        provider_reference: 'simr.abc',
        completed_at: NOW,
      }),
      expect.objectContaining({
        method: 'cash',
        status: 'pending',
        amount: 8000,
        refund_of_payment_id: 8,
        provider_idempotency_key: null,
        provider_reference: null,
        completed_at: null,
      }),
    ]);
    expect(refunds.map((refund) => refund.id)).toEqual([60, 61]);
  });

  it('refuses more than is left, a charge named twice, a declined charge and no transaction', async () => {
    const charge = {
      ...toPayment(paymentRow({ status: 'succeeded', provider_reference: 'sim.a' })),
      collectedByStaffId: null,
      paidOutAt: null,
      paidOutByStaffId: null,
      refundable: money(10000),
    };
    const internal = expect.objectContaining({ code: 'INTERNAL' });
    await expect(
      service.refund([{ charge, amount: money(10001), reference: 'MQ-7K3P9Q' }], 'cancellation'),
    ).rejects.toEqual(internal);
    await expect(
      service.refund(
        [
          { charge, amount: money(1), reference: 'MQ-7K3P9Q' },
          { charge, amount: money(1), reference: 'MQ-7K3P9Q' },
        ],
        'cancellation',
      ),
    ).rejects.toEqual(internal);
    await expect(
      service.refund(
        [
          {
            charge: { ...charge, status: 'declined', refundable: null },
            amount: money(1),
            reference: 'MQ-7K3P9Q',
          },
        ],
        'cancellation',
      ),
    ).rejects.toEqual(internal);
    await expect(
      service.refund([{ charge, amount: money(0), reference: 'MQ-7K3P9Q' }], 'cancellation'),
    ).rejects.toEqual(internal);
    active = false;
    await expect(
      service.refund([{ charge, amount: money(1), reference: 'MQ-7K3P9Q' }], 'cancellation'),
    ).rejects.toEqual(internal);
    expect(provider.refund).not.toHaveBeenCalled();
    expect(repository.insertRefunds).not.toHaveBeenCalled();
  });

  it('pays out a pending refund, or answers null when it was not pending', async () => {
    expect(await service.markPaidOut(61, 3)).toBeNull();
    repository.markPaidOut.mockResolvedValue(
      ledgerRow({
        id: 61,
        kind: 'refund',
        method: 'cash',
        paid_out_at: NOW,
        paid_out_by_staff_id: 3,
      }),
    );
    expect(await service.markPaidOut(61, 3)).toMatchObject({
      id: 61,
      paidOutAt: NOW,
      paidOutByStaffId: 3,
    });
    expect(repository.markPaidOut).toHaveBeenCalledWith(61, 3, NOW);
    active = false;
    await expect(service.markPaidOut(61, 3)).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('reports the money moved in a period, which can be negative, and refund totals', async () => {
    const range = { from: NOW, to: new Date(NOW.getTime() + 1000) };
    expect(await service.moneyMovedBetween(range)).toEqual({
      collected: money(-1500),
      declinedCount: 2,
    });
    expect(await service.refundTotalOf([100], 'cancellation')).toEqual(money(30000));
  });
});
