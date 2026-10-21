import { Injectable } from '@nestjs/common';
import { sha256Hex } from '../../common/crypto/hashing';
import { AppError } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { addToInstant } from '../../common/time/time';
import { PaymentProvider } from './payment-provider';
import {
  SIMULATED_CHARGE_REFERENCE_PATTERN,
  SIMULATED_REFUND_PREFIX,
  SIMULATED_SETTLE_SECONDS,
} from './payments.constants';
import { outcomeOf } from './simulated-tokens';
import type {
  ChargeRequest,
  ChargeResult,
  RefundRequest,
  RefundResult,
  RetrieveRequest,
  SimulatedOutcome,
} from './types';

/**
 * The simulated payment provider (design §7.5; PRD "Payment and messaging providers"). No real
 * money moves. It is stateless: each result follows from the test token, and a slow token's
 * result is ready `SIMULATED_SETTLE_SECONDS` after the charge, judged against the `Clock`, so there
 * is no callback and no timer (tests move the clock).
 *
 * Its charge reference carries everything `retrieve()` needs:
 * `sim.<token>.<settles at, epoch ms>.<first 16 hex of sha256(idempotency key)>`, so the same key
 * gives the same reference, as a real gateway's idempotency would.
 */
@Injectable()
export class SimulatedPaymentProvider extends PaymentProvider {
  constructor(private readonly clock: Clock) {
    super();
  }

  charge(request: ChargeRequest): Promise<ChargeResult> {
    const outcome = outcomeOf(request.token);
    if (!outcome || outcome.method !== request.method) {
      throw new AppError('INTERNAL', 'The simulated provider got a token it does not know.');
    }
    const now = this.clock.now();
    const settlesAt = outcome.slow ? addToInstant(now, { seconds: SIMULATED_SETTLE_SECONDS }) : now;
    const providerReference = `sim.${request.token}.${settlesAt.getTime()}.${keyHash(request.idempotencyKey)}`;
    return Promise.resolve(
      outcome.slow
        ? resultOf(outcome, 'processing', providerReference, settlesAt)
        : resultOf(outcome, outcome.result, providerReference, null),
    );
  }

  retrieve(request: RetrieveRequest): Promise<ChargeResult> {
    const match = SIMULATED_CHARGE_REFERENCE_PATTERN.exec(request.providerReference);
    const outcome = match ? outcomeOf(match[1]!) : undefined;
    if (!match || !outcome) {
      throw new AppError('INTERNAL', 'Not a simulated charge reference.');
    }
    const settlesAt = new Date(Number(match[2]));
    const ready = this.clock.now().getTime() >= settlesAt.getTime();
    return Promise.resolve(
      resultOf(
        outcome,
        ready ? outcome.result : 'processing',
        request.providerReference,
        outcome.slow ? settlesAt : null,
      ),
    );
  }

  refund(request: RefundRequest): Promise<RefundResult> {
    if (!SIMULATED_CHARGE_REFERENCE_PATTERN.test(request.chargeReference)) {
      throw new AppError('INTERNAL', 'Not a simulated charge reference.');
    }
    return Promise.resolve({
      status: 'succeeded',
      providerReference: `${SIMULATED_REFUND_PREFIX}${keyHash(request.idempotencyKey)}`,
    });
  }
}

function keyHash(idempotencyKey: string): string {
  return sha256Hex(idempotencyKey).slice(0, 16);
}

function resultOf(
  outcome: SimulatedOutcome,
  status: ChargeResult['status'],
  providerReference: string,
  settlesAt: Date | null,
): ChargeResult {
  return {
    status,
    providerReference,
    settlesAt,
    card: outcome.card,
    walletType: outcome.walletType,
  };
}
