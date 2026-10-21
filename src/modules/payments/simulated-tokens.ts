import { SIMULATED_PAYMENT_TOKENS } from './enums';
import type { SimulatedOutcome, SimulatedPaymentToken } from './types';

/**
 * What each simulated test token does (design §7.5; PRD "Payment and messaging providers",
 * README "Checkout and tickets"). The checkout form sends a token, never a card number, and the
 * token alone decides the result, the card brand and last four digits, or the wallet.
 */
export const SIMULATED_TOKEN_OUTCOMES: Readonly<Record<SimulatedPaymentToken, SimulatedOutcome>> = {
  sim_card_visa: {
    method: 'card',
    result: 'succeeded',
    slow: false,
    card: { brand: 'visa', last4: '4242' },
    walletType: null,
  },
  sim_card_mastercard: {
    method: 'card',
    result: 'succeeded',
    slow: false,
    card: { brand: 'mastercard', last4: '4444' },
    walletType: null,
  },
  sim_card_meeza: {
    method: 'card',
    result: 'succeeded',
    slow: false,
    card: { brand: 'meeza', last4: '0011' },
    walletType: null,
  },
  sim_card_declined: {
    method: 'card',
    result: 'declined',
    slow: false,
    card: { brand: 'visa', last4: '0002' },
    walletType: null,
  },
  sim_card_slow: {
    method: 'card',
    result: 'succeeded',
    slow: true,
    card: { brand: 'visa', last4: '3184' },
    walletType: null,
  },
  sim_card_slow_declined: {
    method: 'card',
    result: 'declined',
    slow: true,
    card: { brand: 'visa', last4: '0341' },
    walletType: null,
  },
  sim_wallet_apple_pay: {
    method: 'wallet',
    result: 'succeeded',
    slow: false,
    card: null,
    walletType: 'apple_pay',
  },
  sim_wallet_google_pay: {
    method: 'wallet',
    result: 'succeeded',
    slow: false,
    card: null,
    walletType: 'google_pay',
  },
  sim_wallet_cancelled: {
    method: 'wallet',
    result: 'cancelled',
    slow: false,
    card: null,
    walletType: 'apple_pay',
  },
};

export function isSimulatedToken(value: unknown): value is SimulatedPaymentToken {
  return (
    typeof value === 'string' && (SIMULATED_PAYMENT_TOKENS as readonly string[]).includes(value)
  );
}

/** The outcome of a token; undefined for anything that is not a test token. */
export function outcomeOf(token: string): SimulatedOutcome | undefined {
  return isSimulatedToken(token) ? SIMULATED_TOKEN_OUTCOMES[token] : undefined;
}
