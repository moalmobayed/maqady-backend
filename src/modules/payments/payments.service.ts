import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import { money } from '../../common/money/money';
import type { Money } from '../../common/money/types';
import { Clock } from '../../common/time/clock';
import { PaymentProvider } from './payment-provider';
import { PaymentsRepository } from './payments.repository';
import type {
  ChargeOutcome,
  CounterChargeInput,
  DueCharge,
  DueCursor,
  FinishedChargeRow,
  InstantRange,
  LedgerEntry,
  LedgerRow,
  MoneyMoved,
  NewPaymentRow,
  NewRefundRow,
  OnlineChargeInput,
  OnlineRefundInput,
  Payment,
  PaymentRow,
  RefundItem,
  RefundPurpose,
} from './types';

/**
 * The payments ledger and the provider behind it (design §6.2, §7.5, §7.6). Exported for checkout and
 * settlement (U11), counter sales (U13), refunds and payouts (U14) and the Payments screen (U16).
 *
 * Writes join the open transaction and need one (`INTERNAL` otherwise): the caller holds the
 * booking `FOR UPDATE` (design §7.1 step 5), so counts read here stay true until it commits.
 * Every provider call carries our idempotency key, `<reference>-c<n>` for the booking's n-th
 * sale charge and `<reference>-r<n>` for its n-th refund: stable across the write interceptor's
 * retry (a rolled-back row does not count) and unique per attempt.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly payments: PaymentsRepository,
    private readonly provider: PaymentProvider,
    private readonly context: TransactionContext,
    private readonly clock: Clock,
  ) {}

  /**
   * Charges a booking online (design §7.5 step 5): inserts the charge as `processing` (the
   * partial unique index refuses a second live sale charge before any money moves), calls the
   * provider with our key, and records its result. Returns the charge as recorded.
   */
  async chargeOnline(input: OnlineChargeInput): Promise<Payment> {
    this.requireTransaction();
    const now = this.clock.now();
    const attempt = (await this.payments.countOf(input.bookingId, 'charge')) + 1;
    const idempotencyKey = `${input.reference}-c${attempt}`;
    const inserted = await this.payments.insert({
      booking_id: input.bookingId,
      kind: 'charge',
      purpose: 'sale',
      method: input.method,
      status: 'processing',
      amount: input.amount.amount,
      currency: input.amount.currency,
      refund_of_payment_id: null,
      provider_idempotency_key: idempotencyKey,
      provider_reference: null,
      card_brand: null,
      card_last4: null,
      wallet_type: null,
      settles_at: null,
      completed_at: null,
      created_at: now,
      updated_at: now,
    });
    const result = await this.provider.charge({
      amount: input.amount,
      method: input.method,
      token: input.token,
      idempotencyKey,
    });
    const recorded = await this.payments.recordResult(inserted.id, {
      status: result.status,
      provider_reference: result.providerReference,
      card_brand: result.card?.brand ?? null,
      card_last4: result.card?.last4 ?? null,
      wallet_type: result.walletType,
      settles_at: result.status === 'processing' ? result.settlesAt : null,
      completed_at: result.status === 'processing' ? null : now,
      updated_at: now,
    });
    return toPayment(recorded);
  }

  /**
   * Records money taken at the counter (design §7.6; PRD Payments 2, "Statuses": counter payments
   * are never Processing or Declined): a `succeeded` charge at once, collected by the signed-in
   * member, the card terminal's receipt reference kept in `provider_reference` (NULL for cash). No
   * provider is called. The partial unique index refuses a second live sale charge of a booking.
   * Exported for counter sales (U13) and the higher total of an edit (U14).
   */
  async recordCounterCharge(input: CounterChargeInput): Promise<Payment> {
    this.requireTransaction();
    const receipt = input.method === 'card_terminal' ? input.receiptReference : null;
    if (input.method === 'card_terminal' && receipt === null) {
      throw new AppError('INTERNAL', 'A card terminal payment needs its receipt reference.');
    }
    const now = this.clock.now();
    const inserted = await this.payments.insertCounterCharge({
      booking_id: input.bookingId,
      kind: 'charge',
      purpose: input.purpose,
      method: input.method,
      status: 'succeeded',
      amount: input.amount.amount,
      currency: input.amount.currency,
      provider_reference: receipt,
      collected_by_staff_id: input.collectedByStaffId,
      completed_at: now,
      created_at: now,
      updated_at: now,
    });
    return toPayment(inserted);
  }

  /**
   * Gives these due charges the final results the provider gave them, in one statement, and
   * returns only the charges this call finished: a charge another settlement finished first, or
   * whose result is still `processing`, is left out.
   */
  async finishProcessing(outcomes: readonly ChargeOutcome[]): Promise<readonly Payment[]> {
    this.requireTransaction();
    const rows = outcomes.flatMap(({ paymentId, result }): FinishedChargeRow[] =>
      result.status === 'processing' ? [] : [{ id: paymentId, status: result.status }],
    );
    const finished = await this.payments.finishProcessing(rows, this.clock.now());
    return finished.map(toPayment);
  }

  /**
   * Refunds these succeeded online charges in full through the provider (design §7.5: a success
   * whose seats were lost, U14: cancel and refund), one `refund` row each naming its charge.
   * Returns the refunds in input order.
   */
  async refundOnline(inputs: readonly OnlineRefundInput[]): Promise<readonly Payment[]> {
    this.requireTransaction();
    if (inputs.length === 0) return [];
    const now = this.clock.now();
    const counts = new Map(
      (
        await this.payments.countsOf(
          inputs.map(({ charge }) => charge.bookingId),
          'refund',
        )
      ).map((row) => [row.booking_id, Number(row.count)]),
    );
    const rows: NewPaymentRow[] = [];
    for (const { charge, reference } of inputs) {
      if (
        charge.kind !== 'charge' ||
        charge.status !== 'succeeded' ||
        charge.providerReference === null ||
        (charge.method !== 'card' && charge.method !== 'wallet')
      ) {
        throw new AppError('INTERNAL', 'Only a succeeded online charge is refunded online.');
      }
      const attempt = (counts.get(charge.bookingId) ?? 0) + 1;
      counts.set(charge.bookingId, attempt);
      const idempotencyKey = `${reference}-r${attempt}`;
      const refund = await this.provider.refund({
        chargeReference: charge.providerReference,
        amount: charge.amount,
        idempotencyKey,
      });
      rows.push({
        booking_id: charge.bookingId,
        kind: 'refund',
        purpose: 'cancellation',
        method: charge.method,
        status: refund.status,
        amount: charge.amount.amount,
        currency: charge.amount.currency,
        refund_of_payment_id: charge.id,
        provider_idempotency_key: idempotencyKey,
        provider_reference: refund.providerReference,
        card_brand: null,
        card_last4: null,
        wallet_type: null,
        settles_at: null,
        completed_at: now,
        created_at: now,
        updated_at: now,
      });
    }
    return (await this.payments.insertMany(rows)).map(toPayment);
  }

  /** The latest sale charge of each booking that has one, by booking id. */
  async latestSalesOf(bookingIds: readonly number[]): Promise<ReadonlyMap<number, Payment>> {
    const rows = await this.payments.latestSalesOf(bookingIds);
    return new Map(rows.map((row) => [row.booking_id, toPayment(row)]));
  }

  /** The bookings among these with a sale charge still processing (`PAYMENT_IN_PROGRESS`). */
  async processingSaleBookingIds(bookingIds: readonly number[]): Promise<ReadonlySet<number>> {
    return new Set(await this.payments.processingSaleBookingIds(bookingIds));
  }

  /**
   * Up to `limit` processing charges whose result is due now, oldest first; after `after` when
   * given, for the next page.
   */
  async due(limit: number, after?: DueCursor): Promise<readonly DueCharge[]> {
    const rows = await this.payments.due(this.clock.now(), limit, after);
    return rows.flatMap((row) =>
      row.provider_reference === null || row.settles_at === null
        ? []
        : [
            {
              paymentId: row.id,
              bookingId: row.booking_id,
              providerReference: row.provider_reference,
              settlesAt: row.settles_at,
            },
          ],
    );
  }

  /**
   * Every payment and refund of these bookings (U14 admin detail, U16 Payments screen), by
   * booking then oldest first, each succeeded charge with its remaining refundable amount.
   */
  async ledgerOf(bookingIds: readonly number[]): Promise<readonly LedgerEntry[]> {
    return (await this.payments.ledgerOf(bookingIds)).map(toLedgerEntry);
  }

  /** One payment or refund with the ledger fields, or null. */
  async findLedgerEntry(id: number): Promise<LedgerEntry | null> {
    const row = await this.payments.findLedgerEntry(id);
    return row ? toLedgerEntry(row) : null;
  }

  /**
   * Refunds part or all of succeeded charges, each on its own rail (design §7.7, §7.8; U14):
   * a card or wallet charge through the provider with our key `<reference>-r<n>` (`succeeded` at
   * once), a cash or card-terminal charge as a `pending` refund to pay out at the counter. One
   * multi-row insert; returns the refunds in input order.
   *
   * The caller holds the bookings `FOR UPDATE` (design §7.1 step 5), read the charges' remaining
   * amounts under that lock, and refunds each charge at most once per call: an amount above what
   * is left, a charge that is not a succeeded charge, or one named twice is `INTERNAL`.
   */
  async refund(
    items: readonly RefundItem[],
    purpose: RefundPurpose,
  ): Promise<readonly LedgerEntry[]> {
    this.requireTransaction();
    if (items.length === 0) return [];
    if (new Set(items.map((item) => item.charge.id)).size !== items.length) {
      throw new AppError('INTERNAL', 'A charge is refunded at most once per batch.');
    }
    const now = this.clock.now();
    const counts = new Map(
      (
        await this.payments.countsOf(
          items.map(({ charge }) => charge.bookingId),
          'refund',
        )
      ).map((row) => [row.booking_id, Number(row.count)]),
    );
    const rows: NewRefundRow[] = [];
    for (const { charge, amount, reference } of items) {
      assertRefundable(charge, amount);
      const attempt = (counts.get(charge.bookingId) ?? 0) + 1;
      counts.set(charge.bookingId, attempt);
      const base = {
        booking_id: charge.bookingId,
        kind: 'refund',
        purpose,
        method: charge.method,
        amount: amount.amount,
        currency: amount.currency,
        refund_of_payment_id: charge.id,
        created_at: now,
        updated_at: now,
      } as const;
      if (charge.method === 'card' || charge.method === 'wallet') {
        const idempotencyKey = `${reference}-r${attempt}`;
        const refund = await this.provider.refund({
          chargeReference: charge.providerReference!,
          amount,
          idempotencyKey,
        });
        rows.push({
          ...base,
          status: refund.status,
          provider_idempotency_key: idempotencyKey,
          provider_reference: refund.providerReference,
          completed_at: now,
        });
      } else {
        rows.push({
          ...base,
          status: 'pending',
          provider_idempotency_key: null,
          provider_reference: null,
          completed_at: null,
        });
      }
    }
    return (await this.payments.insertRefunds(rows)).map(toLedgerEntry);
  }

  /**
   * Records a pending counter refund as paid out by this staff member (design §7.7), in the open
   * transaction with its booking locked. Returns the refund, or null when it was not pending.
   */
  async markPaidOut(refundId: number, staffUserId: number): Promise<LedgerEntry | null> {
    this.requireTransaction();
    const row = await this.payments.markPaidOut(refundId, staffUserId, this.clock.now());
    return row ? toLedgerEntry(row) : null;
  }

  /**
   * The money that moved in a period (PRD "Collected": money taken minus refunds paid out, on the
   * day it moved) and how many charges were declined in it (U14's cards, U16's KPIs).
   */
  async moneyMovedBetween(range: InstantRange): Promise<MoneyMoved> {
    const row = await this.payments.moneyMovedBetween(range);
    return { collected: money(row.collected), declinedCount: row.declined };
  }

  /** The total of these bookings' refunds of one purpose, pending ones included. */
  async refundTotalOf(bookingIds: readonly number[], purpose: RefundPurpose): Promise<Money> {
    return money(await this.payments.refundTotalOf(bookingIds, purpose));
  }

  private requireTransaction(): void {
    if (!this.context.isActive()) {
      throw new AppError('INTERNAL', 'Payments are written inside a transaction.');
    }
  }
}

/** A ledger row as the services see it: the payment, its counter and payout facts, its remainder. */
export function toLedgerEntry(row: LedgerRow): LedgerEntry {
  return {
    ...toPayment(row),
    collectedByStaffId: row.collected_by_staff_id,
    paidOutAt: row.paid_out_at,
    paidOutByStaffId: row.paid_out_by_staff_id,
    refundable:
      row.kind === 'charge' && row.status === 'succeeded'
        ? money(row.amount - row.refunded_amount, row.currency)
        : null,
  };
}

/** A refund of `amount` from `charge` is possible: a succeeded charge with that much left. */
function assertRefundable(charge: LedgerEntry, amount: Money): void {
  const online = charge.method === 'card' || charge.method === 'wallet';
  if (
    charge.kind !== 'charge' ||
    charge.status !== 'succeeded' ||
    charge.refundable === null ||
    !Number.isInteger(amount.amount) ||
    amount.amount <= 0 ||
    amount.currency !== charge.amount.currency ||
    amount.amount > charge.refundable.amount ||
    (online && charge.providerReference === null)
  ) {
    throw new AppError('INTERNAL', 'Only what is left of a succeeded charge is refunded.');
  }
}

/** A payment row as the services see it. */
export function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    bookingId: row.booking_id,
    kind: row.kind,
    purpose: row.purpose,
    method: row.method,
    status: row.status,
    amount: money(row.amount, row.currency),
    refundOfPaymentId: row.refund_of_payment_id,
    providerReference: row.provider_reference,
    card:
      row.card_brand !== null && row.card_last4 !== null
        ? { brand: row.card_brand, last4: row.card_last4 }
        : null,
    walletType: row.wallet_type,
    settlesAt: row.settles_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}
