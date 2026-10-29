import { COUNTER_PAYMENT_METHODS } from '../payments/enums';
import type { PaymentMethod, PaymentStatus } from '../payments/types';
import type {
  PaymentChannel,
  TransactionFailureReason,
  TransactionSqlCondition,
  TransactionStatus,
  TransactionStatusInput,
} from './types';

/**
 * The one owner of the Payments screen's transaction statuses (design §13.3; PRD "Payments screen
 * transactions"), in code and in SQL, like `booking-status.sql.ts` for bookings:
 *
 * | Stored                  | Shown                                                         |
 * |-------------------------|---------------------------------------------------------------|
 * | charge `processing`     | `pending`                                                     |
 * | charge `succeeded`      | `succeeded`, or `refunded` once its succeeded refunds reach its amount |
 * | charge `declined`       | `failed`, reason `declined`                                   |
 * | charge `cancelled`      | `failed`, reason `cancelled` (a wallet the customer closed)   |
 * | refund `pending`        | `pending` (a counter refund waiting to be paid out)           |
 * | refund `succeeded`      | `succeeded` (shown with a negative amount)                    |
 *
 * A charge whose counter refund is still pending stays `succeeded`: no money has gone back yet.
 */
export function transactionStatusOf(input: TransactionStatusInput): TransactionStatus {
  switch (input.status) {
    case 'processing':
    case 'pending':
      return 'pending';
    case 'declined':
    case 'cancelled':
      return 'failed';
    case 'succeeded':
      return input.kind === 'charge' && input.refundedAmount >= input.amount
        ? 'refunded'
        : 'succeeded';
  }
}

/** Why a row is shown `failed`; null for every other row. */
export function failureReasonOf(status: PaymentStatus): TransactionFailureReason | null {
  if (status === 'declined') return 'declined';
  if (status === 'cancelled') return 'cancelled';
  return null;
}

/** `online` for card and wallet, `counter` for cash and card terminal. */
export function channelOfMethod(method: PaymentMethod): PaymentChannel {
  return (COUNTER_PAYMENT_METHODS as readonly PaymentMethod[]).includes(method)
    ? 'counter'
    : 'online';
}

/**
 * The SQL condition of one shown status on a `payments` row aliased `alias` (a code constant,
 * never input). "Fully refunded" sums the charge's succeeded refunds through
 * `idx_payments_refund_of_payment_id`.
 */
export function transactionStatusPredicate(
  status: TransactionStatus,
  alias: string,
): TransactionSqlCondition {
  const p = alias;
  const fullyRefunded = `(SELECT COALESCE(SUM(fr.amount), 0) FROM payments AS fr WHERE fr.refund_of_payment_id = ${p}.id AND fr.status = 'succeeded') >= ${p}.amount`;
  switch (status) {
    case 'pending':
      return { sql: `${p}.status IN ('processing', 'pending')`, bindings: [] };
    case 'failed':
      return { sql: `${p}.status IN ('declined', 'cancelled')`, bindings: [] };
    case 'refunded':
      return {
        sql: `(${p}.kind = 'charge' AND ${p}.status = 'succeeded' AND ${fullyRefunded})`,
        bindings: [],
      };
    case 'succeeded':
      return {
        sql: `(${p}.status = 'succeeded' AND NOT (${p}.kind = 'charge' AND ${fullyRefunded}))`,
        bindings: [],
      };
  }
}
