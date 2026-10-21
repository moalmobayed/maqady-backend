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
    'insert' | 'recordResult' | 'countOf' | 'countsOf' | 'insertMany' | 'finishProcessing' | 'due',
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

  it('lists due charges that have a provider reference', async () => {
    repository.due.mockResolvedValue([
      paymentRow({ id: 1, provider_reference: 'sim.a' }),
      paymentRow({ id: 2, provider_reference: null }),
    ]);
    expect(await service.due(100)).toEqual([
      { paymentId: 1, bookingId: 100, providerReference: 'sim.a' },
    ]);
    expect(repository.due).toHaveBeenCalledWith(NOW, 100);
  });
});
