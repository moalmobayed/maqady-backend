import type {
  ChargeRequest,
  ChargeResult,
  RefundRequest,
  RefundResult,
  RetrieveRequest,
} from './types';

/**
 * A payment gateway, as checkout and settlement use it (design §7.5). Every call carries our
 * idempotency key, as a real gateway requires, so a retried call never charges or refunds twice.
 * v1 binds `SimulatedPaymentProvider`; a real gateway would be another implementation.
 *
 * - `charge()` answers `succeeded`, `declined`, `cancelled` (a wallet the customer closed) or
 *   `processing` with the instant its result is ready (`settlesAt`).
 * - `retrieve()` answers a charge's current result, `processing` until it is ready.
 * - `refund()` gives a succeeded charge's money back.
 *
 * A provider failure is an `AppError` (`SERVICE_UNAVAILABLE`), never a decline.
 */
export abstract class PaymentProvider {
  abstract charge(request: ChargeRequest): Promise<ChargeResult>;
  abstract retrieve(request: RetrieveRequest): Promise<ChargeResult>;
  abstract refund(request: RefundRequest): Promise<RefundResult>;
}
