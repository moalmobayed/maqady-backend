import { sha256Hex } from '../../../../src/common/crypto/hashing';
import { money } from '../../../../src/common/money/money';
import { SIMULATED_PAYMENT_TOKENS } from '../../../../src/modules/payments/enums';
import { SimulatedPaymentProvider } from '../../../../src/modules/payments/simulated-payment.provider';
import {
  outcomeOf,
  SIMULATED_TOKEN_OUTCOMES,
} from '../../../../src/modules/payments/simulated-tokens';
import type { OnlinePaymentMethod } from '../../../../src/modules/payments/types';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-16T16:00:00Z');
const TEN_SECONDS_LATER = new Date('2026-10-16T16:00:10Z');

describe('SimulatedPaymentProvider', () => {
  let clock: TestClock;
  let provider: SimulatedPaymentProvider;

  const charge = (token: string, method: OnlinePaymentMethod = 'card', key = 'MQ-7K3P9Q-c1') =>
    provider.charge({ amount: money(38000), method, token, idempotencyKey: key });

  beforeEach(() => {
    clock = new TestClock(NOW);
    provider = new SimulatedPaymentProvider(clock);
  });

  it('decides every documented test token as the README table says', async () => {
    const results = await Promise.all(
      SIMULATED_PAYMENT_TOKENS.map(async (token) => {
        const result = await charge(token, SIMULATED_TOKEN_OUTCOMES[token].method);
        return [token, result.status, result.card, result.walletType];
      }),
    );
    expect(results).toEqual([
      ['sim_card_visa', 'succeeded', { brand: 'visa', last4: '4242' }, null],
      ['sim_card_mastercard', 'succeeded', { brand: 'mastercard', last4: '4444' }, null],
      ['sim_card_meeza', 'succeeded', { brand: 'meeza', last4: '0011' }, null],
      ['sim_card_declined', 'declined', { brand: 'visa', last4: '0002' }, null],
      ['sim_card_slow', 'processing', { brand: 'visa', last4: '3184' }, null],
      ['sim_card_slow_declined', 'processing', { brand: 'visa', last4: '0341' }, null],
      ['sim_wallet_apple_pay', 'succeeded', null, 'apple_pay'],
      ['sim_wallet_google_pay', 'succeeded', null, 'google_pay'],
      ['sim_wallet_cancelled', 'cancelled', null, 'apple_pay'],
    ]);
  });

  it('answers a slow token with processing, ready 10 seconds later by the clock', async () => {
    const slow = await charge('sim_card_slow');
    expect(slow).toMatchObject({ status: 'processing', settlesAt: TEN_SECONDS_LATER });

    clock.set(new Date(TEN_SECONDS_LATER.getTime() - 1));
    expect(await provider.retrieve({ providerReference: slow.providerReference })).toMatchObject({
      status: 'processing',
      settlesAt: TEN_SECONDS_LATER,
    });
    clock.set(TEN_SECONDS_LATER);
    expect(await provider.retrieve({ providerReference: slow.providerReference })).toMatchObject({
      status: 'succeeded',
      card: { brand: 'visa', last4: '3184' },
    });
    clock.advance({ hours: 1 });
    const declined = await charge('sim_card_slow_declined', 'card', 'MQ-7K3P9Q-c2');
    clock.advance({ seconds: 11 });
    expect(
      (await provider.retrieve({ providerReference: declined.providerReference })).status,
    ).toBe('declined');
  });

  it('answers an immediate result with no settlement time, and retrieves it as final', async () => {
    const paid = await charge('sim_card_visa');
    expect(paid.settlesAt).toBeNull();
    expect((await provider.retrieve({ providerReference: paid.providerReference })).status).toBe(
      'succeeded',
    );
  });

  it('derives the same reference from the same key, as a gateway idempotency key would', async () => {
    const first = await charge('sim_card_visa', 'card', 'MQ-7K3P9Q-c1');
    const again = await charge('sim_card_visa', 'card', 'MQ-7K3P9Q-c1');
    const other = await charge('sim_card_visa', 'card', 'MQ-7K3P9Q-c2');
    expect(again.providerReference).toBe(first.providerReference);
    expect(other.providerReference).not.toBe(first.providerReference);
    expect(first.providerReference).toBe(
      `sim.sim_card_visa.${NOW.getTime()}.${sha256Hex('MQ-7K3P9Q-c1').slice(0, 16)}`,
    );
  });

  it('refunds a simulated charge, and refuses what it did not issue with INTERNAL', async () => {
    const paid = await charge('sim_wallet_google_pay', 'wallet');
    const refund = await provider.refund({
      chargeReference: paid.providerReference,
      amount: money(38000),
      idempotencyKey: 'MQ-7K3P9Q-r1',
    });
    expect(refund).toEqual({
      status: 'succeeded',
      providerReference: `simr.${sha256Hex('MQ-7K3P9Q-r1').slice(0, 16)}`,
    });
    await expect(
      provider.refund({ chargeReference: 'ch_123', amount: money(1), idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
    for (const reference of [
      'ch_123',
      'sim.sim_card_bogus.1.0123456789abcdef',
      'sim.sim_card_visa.x.0',
    ]) {
      await expect(provider.retrieve({ providerReference: reference })).rejects.toThrow(
        'Not a simulated charge reference.',
      );
    }
  });

  it('refuses an unknown token, or a token of the other method, with INTERNAL', async () => {
    await expect(charge('4242424242424242')).rejects.toMatchObject({ code: 'INTERNAL' });
    await expect(charge('sim_card_visa', 'wallet')).rejects.toThrow('does not know');
    expect(outcomeOf('sim_wallet_cancelled')).toMatchObject({
      method: 'wallet',
      result: 'cancelled',
    });
    expect(outcomeOf('nope')).toBeUndefined();
  });
});
