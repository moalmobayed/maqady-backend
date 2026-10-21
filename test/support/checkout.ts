import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import type { Response } from 'supertest';
import { registerCustomer } from './customer-auth';
import { expectHold } from './holds';
import type {
  CustomerHoldFixture,
  CustomerHoldOptions,
  PaymentBody,
  StoredPayment,
  TestApp,
} from './types';

/**
 * Checkout fixtures for integration tests (U11), through the real routes and services, so every
 * rule, lock and audit row applies. Later units (My Bookings, box office, admin bookings) use
 * them for paid bookings.
 *
 * @example
 * const { customer, reference } = await customerHold(testApp, showtime.showtimeId, ['B2', 'B3']);
 * const paid = await pay(testApp, customer.authorization, reference);
 */

/** The card payment that succeeds at once. */
export const VISA: PaymentBody = { method: 'card', token: 'sim_card_visa' };

/** A new customer, signed in (with `phone` when given), holding `seats` of the showtime. */
export async function customerHold(
  testApp: TestApp,
  showtimeId: number,
  seats: readonly string[],
  options: CustomerHoldOptions = {},
): Promise<CustomerHoldFixture> {
  const customer = await registerCustomer(
    testApp,
    options.fullName === undefined ? {} : { fullName: options.fullName },
  );
  if (options.phone !== undefined) {
    const updated = await testApp
      .http()
      .patch('/api/v1/me')
      .set('Authorization', customer.authorization)
      .send({ phone: options.phone });
    if (updated.status !== 200) {
      throw new Error(`customerHold phone: ${updated.status} ${JSON.stringify(updated.body)}`);
    }
  }
  const hold = await expectHold(testApp, showtimeId, seats, {
    authorization: customer.authorization,
  });
  const row = await testApp
    .knex('bookings')
    .select<{ id: number }[]>('id')
    .where({ reference: hold.reference })
    .first();
  return {
    customer,
    reference: hold.reference,
    bookingId: row!.id,
    hold: hold as unknown as CustomerHoldFixture['hold'],
  };
}

/** `POST /bookings/{ref}/payments` with a new `Idempotency-Key` unless one is given. */
export function pay(
  testApp: TestApp,
  authorization: string,
  reference: string,
  body: PaymentBody = VISA,
  key: string = randomUUID(),
): Promise<Response> {
  return testApp
    .http()
    .post(`/api/v1/bookings/${reference}/payments`)
    .set('Authorization', authorization)
    .set('Idempotency-Key', key)
    .send(body);
}

/** Every `payments` row of a booking (or of every booking), in id order. */
export async function readPayments(knex: Knex, bookingId?: number): Promise<StoredPayment[]> {
  const query = knex('payments')
    .select<StoredPayment[]>(
      'id',
      'booking_id',
      'kind',
      'purpose',
      'method',
      'status',
      'amount',
      'refund_of_payment_id',
      'provider_idempotency_key',
      'provider_reference',
      'card_brand',
      'card_last4',
      'wallet_type',
      'settles_at',
      'completed_at',
    )
    .orderBy('id');
  return bookingId === undefined ? query : query.where({ booking_id: bookingId });
}

/**
 * The text runs of an uncompressed pdfkit file, one per line it drew: each `[<hex> n <hex>] TJ`
 * (or `<hex> Tj`) decoded from WinAnsi, the kerning numbers left out. Enough to assert what a
 * ticket says without a PDF-parsing dependency.
 */
export function pdfTextRuns(pdf: Buffer): string[] {
  const content = pdf.toString('latin1');
  const runs: string[] = [];
  for (const match of content.matchAll(
    /\[((?:<[0-9a-fA-F]*>|\s|-?[0-9.]+)*)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g,
  )) {
    const hexes =
      match[1] !== undefined
        ? [...match[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((m) => m[1]!)
        : [match[2]!];
    runs.push(Buffer.from(hexes.join(''), 'hex').toString('latin1'));
  }
  return runs;
}

/** How many rectangles (`re` operators) the PDF's content draws. */
export function pdfRectangleCount(pdf: Buffer): number {
  return [
    ...pdf.toString('latin1').matchAll(/(?:^|\s)-?[0-9.]+ -?[0-9.]+ -?[0-9.]+ -?[0-9.]+ re(?=\s)/g),
  ].length;
}
