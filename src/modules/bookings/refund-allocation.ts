import { AppError } from '../../common/errors/app-error';
import { money } from '../../common/money/money';
import type { Money } from '../../common/money/types';
import type { LedgerEntry } from '../payments/types';
import type { PlannedRefund } from './types';

/**
 * The succeeded charges of a booking with money left to refund, newest first (design §7.8 step
 * 6: "refunded across the succeeded charges, newest first"): latest `createdAt`, then the higher
 * id.
 */
export function refundableCharges(ledger: readonly LedgerEntry[]): LedgerEntry[] {
  return ledger
    .filter(
      (entry) =>
        entry.kind === 'charge' &&
        entry.status === 'succeeded' &&
        entry.refundable !== null &&
        entry.refundable.amount > 0,
    )
    .sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() || (b.id > a.id ? 1 : b.id < a.id ? -1 : 0),
    );
}

/**
 * Splits `amount` across the booking's refundable charges, newest first, each up to what is left
 * of it (design §7.8 step 6, §7.7 "per charge"): a partial refund of a charge is allowed, so a
 * lower total gives back exactly the difference, each part on its own rail. More than the charges
 * hold is `INTERNAL`: a booking's net payments always equal its total.
 */
export function allocateRefund(ledger: readonly LedgerEntry[], amount: Money): PlannedRefund[] {
  let left = amount.amount;
  const planned: PlannedRefund[] = [];
  for (const charge of refundableCharges(ledger)) {
    if (left <= 0) break;
    const take = Math.min(left, charge.refundable!.amount);
    planned.push({ charge, amount: money(take, amount.currency) });
    left -= take;
  }
  if (left > 0) {
    throw new AppError('INTERNAL', "A refund is larger than what the booking's charges hold.");
  }
  return planned;
}

/** Every refundable charge for all it has left: a cancel and refund (design §7.7). */
export function refundEverything(ledger: readonly LedgerEntry[]): PlannedRefund[] {
  return refundableCharges(ledger).map((charge) => ({ charge, amount: charge.refundable! }));
}
