import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import { pay, customerHold, readPayments, VISA } from '../../../support/checkout';
import { TestClock } from '../../../support/clock';
import { blockCustomer, registerCustomer, signInCustomer } from '../../../support/customer-auth';
import { bookableShowtime, expectHold, holdSeats, seatMapClient } from '../../../support/holds';
import { RecordingEmailSender } from '../../../support/messaging/recording-email-sender';
import { cancelShowtime } from '../../../support/showtimes';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { buildTestConfig } from '../../../support/test-config';
import { setTheaterStatus } from '../../../support/theaters';
import type { BookableShowtimeFixture, StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(120_000);

const NOW = new Date('2026-10-10T10:00:00+03:00');
const QR_PATTERN = /^MQ1\.MQ-[2-9A-HJKMNP-Z]{6}\.1\.[A-Za-z0-9_-]{22}$/;

interface StoredBooking {
  status: string;
  has_declined_payment: boolean;
  hold_expires_at: Date;
  confirmed_at: Date | null;
  qr_version: number | null;
}

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

/**
 * `POST /bookings/{ref}/payments` (design §7.5; PRD Payments 1–4, Seats 5, C8) against the real
 * app and Postgres, with the simulated provider (our own code, never mocked) and the clock moved
 * by hand. Only the email sender, an external service, is replaced.
 */
describe('Paying for a hold (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let showtime: BookableShowtimeFixture;
  const clock = new TestClock(NOW);

  const booking = (reference: string): Promise<StoredBooking> =>
    testApp
      .knex('bookings')
      .select<StoredBooking[]>(
        'status',
        'has_declined_payment',
        'hold_expires_at',
        'confirmed_at',
        'qr_version',
      )
      .where({ reference })
      .first() as Promise<StoredBooking>;
  const claims = (bookingId: number) =>
    testApp
      .knex('seat_claims')
      .select<{ seat_label: string; claimed_until: Date | null }[]>('seat_label', 'claimed_until')
      .where({ booking_id: bookingId })
      .orderBy('seat_label');
  const auditActions = async (bookingId: number): Promise<string[]> =>
    (
      await testApp
        .knex('audit_events')
        .select<{ action: string }[]>('action')
        .where({ booking_id: bookingId })
        .orderBy('id')
    ).map((row) => row.action);
  const getBooking = (reference: string, authorization: string) =>
    testApp.http().get(`/api/v1/bookings/${reference}`).set('Authorization', authorization);

  beforeAll(async () => {
    testApp = await createTestApp({
      clock,
      overrides: [{ provide: EmailSender, useValue: new RecordingEmailSender() }],
    });
    admin = await staffSession(testApp, 'admin');
    showtime = await bookableShowtime(testApp, admin);
  });

  beforeEach(async () => {
    clock.set(NOW);
    await testApp.knex.raw(
      'TRUNCATE payments, seat_claims, booking_seats, bookings, hold_refusals, audit_events, idempotency_keys, messages CASCADE',
    );
  });

  afterAll(async () => {
    await testApp.close();
  });

  describe('results', () => {
    it('confirms a hold paid by Visa: seats sold, QR version 1, seat.booked and the history', async () => {
      const map = await seatMapClient(testApp);
      map.send('subscribe', { showtimeId: showtime.showtimeId });
      expect((await map.next()).event).toBe('snapshot');
      const { customer, reference, bookingId } = await customerHold(testApp, showtime.showtimeId, [
        'B3',
        'B2',
      ]);
      expect((await map.next()).event).toBe('seat.held');

      const response = await pay(testApp, customer.authorization, reference);

      expect(response.status).toBe(201);
      expect(response.body.payment).toEqual({
        status: 'succeeded',
        method: 'card',
        amount: { amount: 38000, currency: 'EGP' },
        card: { brand: 'visa', last4: '4242' },
        walletType: null,
        createdAt: '2026-10-10T10:00:00+03:00',
        completedAt: '2026-10-10T10:00:00+03:00',
        settlesAt: null,
      });
      expect(response.body.booking).toMatchObject({
        reference,
        status: 'confirmed',
        paymentStatus: 'paid',
        confirmedAt: '2026-10-10T10:00:00+03:00',
        payment: { status: 'succeeded', card: { brand: 'visa', last4: '4242' } },
        ticket: { admits: 2 },
      });
      expect(response.body.booking.ticket.qrCode).toMatch(QR_PATTERN);
      expect(response.body.booking.ticket.qrCode).toContain(`.${reference}.`);

      expect(await booking(reference)).toMatchObject({
        status: 'confirmed',
        confirmed_at: NOW,
        qr_version: 1,
      });
      expect(await claims(bookingId)).toEqual([
        { seat_label: 'B2', claimed_until: null },
        { seat_label: 'B3', claimed_until: null },
      ]);
      const [charge, ...others] = await readPayments(testApp.knex, bookingId);
      expect(others).toEqual([]);
      expect(charge).toMatchObject({
        kind: 'charge',
        purpose: 'sale',
        method: 'card',
        status: 'succeeded',
        amount: 38000,
        provider_idempotency_key: `${reference}-c1`,
        card_brand: 'visa',
        card_last4: '4242',
        settles_at: null,
        completed_at: NOW,
      });
      expect(charge!.provider_reference).toMatch(/^sim\.sim_card_visa\.\d+\.[0-9a-f]{16}$/);
      expect(await map.next()).toEqual({
        event: 'seat.booked',
        data: { showtimeId: showtime.showtimeId, labels: ['B2', 'B3'] },
      });
      expect(await auditActions(bookingId)).toEqual([
        'booking.held',
        'booking.confirmed',
        'payment.succeeded',
      ]);
      const audit = await testApp
        .knex('audit_events')
        .select('actor_kind', 'actor_customer_id', 'entity_type', 'metadata')
        .where({ booking_id: bookingId, action: 'payment.succeeded' })
        .first();
      expect(audit).toEqual({
        actor_kind: 'customer',
        actor_customer_id: customer.customerId,
        entity_type: 'payment',
        metadata: { method: 'card', purpose: 'sale' },
      });
      await map.close();
    });

    it('records the wallet of an Apple Pay payment and no card', async () => {
      const { customer, reference } = await customerHold(testApp, showtime.showtimeId, ['C4']);
      const response = await pay(testApp, customer.authorization, reference, {
        method: 'wallet',
        token: 'sim_wallet_apple_pay',
      });
      expect(response.status).toBe(201);
      expect(response.body.payment).toMatchObject({
        status: 'succeeded',
        method: 'wallet',
        card: null,
        walletType: 'apple_pay',
      });
      expect(response.body.booking.status).toBe('confirmed');
    });

    it('answers a decline with 201 and keeps the hold payable; a new key pays, the same key replays the decline', async () => {
      const { customer, reference, bookingId } = await customerHold(testApp, showtime.showtimeId, [
        'C5',
      ]);
      const key = randomUUID();
      const declined = await pay(
        testApp,
        customer.authorization,
        reference,
        { method: 'card', token: 'sim_card_declined' },
        key,
      );
      expect(declined.status).toBe(201);
      expect(declined.body.payment).toMatchObject({
        status: 'declined',
        card: { brand: 'visa', last4: '0002' },
        completedAt: '2026-10-10T10:00:00+03:00',
      });
      expect(declined.body.booking).toMatchObject({
        status: 'held',
        paymentStatus: 'declined',
        ticket: null,
      });
      expect(await booking(reference)).toMatchObject({
        status: 'held',
        has_declined_payment: true,
      });
      const seats = await testApp.http().get(`/api/v1/showtimes/${showtime.showtimeId}/seats`);
      expect(seats.body.seats).toEqual([
        { label: 'C5', state: 'held', heldUntil: '2026-10-10T10:05:00+03:00' },
      ]);

      clock.advance({ minutes: 2 });
      const replay = await pay(
        testApp,
        customer.authorization,
        reference,
        { method: 'card', token: 'sim_card_declined' },
        key,
      );
      expect(replay.status).toBe(201);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body).toEqual(declined.body);

      const paid = await pay(testApp, customer.authorization, reference, {
        method: 'card',
        token: 'sim_card_mastercard',
      });
      expect(paid.status).toBe(201);
      expect(paid.body.booking).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });
      expect(
        (await readPayments(testApp.knex, bookingId)).map((row) => [
          row.status,
          row.provider_idempotency_key,
        ]),
      ).toEqual([
        ['declined', `${reference}-c1`],
        ['succeeded', `${reference}-c2`],
      ]);
    });

    it('treats a closed wallet as cancelled, not declined: the hold then ends Abandoned', async () => {
      const { customer, reference } = await customerHold(testApp, showtime.showtimeId, ['C6']);
      const response = await pay(testApp, customer.authorization, reference, {
        method: 'wallet',
        token: 'sim_wallet_cancelled',
      });
      expect(response.status).toBe(201);
      expect(response.body.payment).toMatchObject({ status: 'cancelled', walletType: 'apple_pay' });
      expect(response.body.booking).toMatchObject({ status: 'held', paymentStatus: 'unpaid' });
      expect((await booking(reference)).has_declined_payment).toBe(false);

      clock.advance({ minutes: 5 });
      const ended = await getBooking(reference, customer.authorization);
      expect(ended.body).toMatchObject({ status: 'abandoned', paymentStatus: 'unpaid' });
    });

    it('ends a declined hold as Failed, and then refuses to pay it (HOLD_EXPIRED)', async () => {
      const { customer, reference } = await customerHold(testApp, showtime.showtimeId, ['C7']);
      await pay(testApp, customer.authorization, reference, {
        method: 'card',
        token: 'sim_card_declined',
      });
      clock.advance({ minutes: 5 });
      const ended = await getBooking(reference, customer.authorization);
      expect(ended.body).toMatchObject({ status: 'failed', paymentStatus: 'declined' });
      expectError(await pay(testApp, customer.authorization, reference), 409, 'HOLD_EXPIRED');
    });
  });

  describe('the hold timer', () => {
    it('pays 1 ms before the hold ends', async () => {
      const { customer, reference } = await customerHold(testApp, showtime.showtimeId, ['D2']);
      clock.advance({ minutes: 5, milliseconds: -1 });
      const response = await pay(testApp, customer.authorization, reference);
      expect(response.status).toBe(201);
      expect(response.body.booking.status).toBe('confirmed');
    });

    it('refuses the instant the hold ends and writes nothing: no charge, message, history or claim change', async () => {
      const { customer, reference, bookingId } = await customerHold(testApp, showtime.showtimeId, [
        'D3',
      ]);
      const claimsBefore = await claims(bookingId);
      const auditBefore = await auditActions(bookingId);
      clock.advance({ minutes: 5 });

      expectError(await pay(testApp, customer.authorization, reference), 409, 'HOLD_EXPIRED');
      expect(await readPayments(testApp.knex, bookingId)).toEqual([]);
      expect(
        await testApp.knex('messages').where({ related_booking_id: bookingId }).count({ n: '*' }),
      ).toEqual([{ n: 0 }]);
      expect(await auditActions(bookingId)).toEqual(auditBefore);
      expect(await claims(bookingId)).toEqual(claimsBefore);
      expect((await getBooking(reference, customer.authorization)).body.status).toBe('abandoned');
    });

    it('refuses a hold that lost a seat to another hold (HOLD_EXPIRED), whatever its own end says', async () => {
      const { customer, reference } = await customerHold(testApp, showtime.showtimeId, ['D4']);
      clock.advance({ minutes: 6 });
      await expectHold(testApp, showtime.showtimeId, ['D4']);
      // The rival owns D4 now; even a hold whose end were moved forward must not pay for it.
      await testApp
        .knex('bookings')
        .where({ reference })
        .update({ hold_expires_at: new Date(clock.now().getTime() + 60_000) });
      expectError(await pay(testApp, customer.authorization, reference), 409, 'HOLD_EXPIRED');
      expect(await readPayments(testApp.knex)).toEqual([]);
    });
  });

  describe('refusals', () => {
    it('refuses a started showtime, a paused theater and a cancelled showtime with their reason', async () => {
      const started = await customerHold(testApp, showtime.showtimeId, ['A2']);
      clock.set(showtime.startsAt);
      // A day later the access token has expired: sign in again, as the customer would.
      const again = await signInCustomer(
        testApp,
        started.customer.email,
        started.customer.password,
      );
      const startedResponse = await pay(testApp, again.authorization, started.reference);
      expectError(startedResponse, 409, 'SHOWTIME_NOT_BOOKABLE');
      expect(startedResponse.body.error.details).toEqual({ reason: 'started' });

      clock.set(NOW);
      const paused = await customerHold(testApp, showtime.showtimeId, ['A3']);
      await setTheaterStatus(testApp, admin.authorization, showtime.theaterId, 'sales_paused');
      try {
        const pausedResponse = await pay(testApp, paused.customer.authorization, paused.reference);
        expectError(pausedResponse, 409, 'SHOWTIME_NOT_BOOKABLE');
        expect(pausedResponse.body.error.details).toEqual({ reason: 'sales_paused' });
      } finally {
        await setTheaterStatus(testApp, admin.authorization, showtime.theaterId, 'active');
      }

      const other = await bookableShowtime(testApp, admin, {
        fixture: showtime,
        startTime: '15:00',
      });
      const cancelled = await customerHold(testApp, other.showtimeId, ['A4']);
      await cancelShowtime(testApp, admin, other.showtimeId);
      const cancelledResponse = await pay(
        testApp,
        cancelled.customer.authorization,
        cancelled.reference,
      );
      expectError(cancelledResponse, 409, 'SHOWTIME_NOT_BOOKABLE');
      expect(cancelledResponse.body.error.details).toEqual({ reason: 'cancelled' });
      expect(await readPayments(testApp.knex)).toEqual([]);
    });

    it('refuses to pay twice (ALREADY_PAID) and while a payment processes (PAYMENT_IN_PROGRESS)', async () => {
      const paid = await customerHold(testApp, showtime.showtimeId, ['A5']);
      expect((await pay(testApp, paid.customer.authorization, paid.reference)).status).toBe(201);
      expectError(
        await pay(testApp, paid.customer.authorization, paid.reference),
        409,
        'ALREADY_PAID',
      );

      const slow = await customerHold(testApp, showtime.showtimeId, ['A6']);
      const processing = await pay(testApp, slow.customer.authorization, slow.reference, {
        method: 'card',
        token: 'sim_card_slow',
      });
      expect(processing.body.payment.status).toBe('processing');
      expectError(
        await pay(testApp, slow.customer.authorization, slow.reference),
        409,
        'PAYMENT_IN_PROGRESS',
      );
      expect((await readPayments(testApp.knex, slow.bookingId)).length).toBe(1);
    });

    it('refuses a blocked customer and writes nothing', async () => {
      const { customer, reference, bookingId } = await customerHold(testApp, showtime.showtimeId, [
        'A7',
      ]);
      await blockCustomer(testApp, customer.customerId);
      expectError(await pay(testApp, customer.authorization, reference), 403, 'ACCOUNT_BLOCKED');
      expect(await readPayments(testApp.knex, bookingId)).toEqual([]);
      expect((await booking(reference)).status).toBe('held');
    });

    it("answers NOT_FOUND for someone else's booking, a guest hold and an unknown reference; 401 without a customer token", async () => {
      const { reference } = await customerHold(testApp, showtime.showtimeId, ['B5']);
      const stranger = await registerCustomer(testApp);
      expectError(await pay(testApp, stranger.authorization, reference), 404, 'NOT_FOUND');
      const guest = await expectHold(testApp, showtime.showtimeId, ['B6']);
      expectError(await pay(testApp, stranger.authorization, guest.reference), 404, 'NOT_FOUND');
      expectError(await pay(testApp, stranger.authorization, 'MQ-222222'), 404, 'NOT_FOUND');

      const anonymous = await testApp
        .http()
        .post(`/api/v1/bookings/${reference}/payments`)
        .set('Idempotency-Key', randomUUID())
        .send(VISA);
      expectError(anonymous, 401, 'UNAUTHENTICATED');
      const boxOffice = await staffSession(testApp, 'box_office');
      expectError(await pay(testApp, boxOffice.authorization, reference), 401, 'UNAUTHENTICATED');
      expect(await readPayments(testApp.knex)).toEqual([]);
    });

    it('validates the reference, the key, the method and the token before anything else', async () => {
      const { customer, reference } = await customerHold(testApp, showtime.showtimeId, ['B7']);
      expectError(
        await pay(testApp, customer.authorization, 'MQ-0OIL11'),
        400,
        'VALIDATION_FAILED',
      );
      const noKey = await testApp
        .http()
        .post(`/api/v1/bookings/${reference}/payments`)
        .set('Authorization', customer.authorization)
        .send(VISA);
      expectError(noKey, 400, 'IDEMPOTENCY_KEY_REQUIRED');

      const unknown = await pay(testApp, customer.authorization, reference, {
        method: 'card',
        token: '4242424242424242',
      });
      expectError(unknown, 400, 'VALIDATION_FAILED');
      const mismatched = await pay(testApp, customer.authorization, reference, {
        method: 'wallet',
        token: 'sim_card_visa',
      });
      expectError(mismatched, 400, 'VALIDATION_FAILED');
      expect(mismatched.body.error.details.fields).toEqual([
        { field: 'token', messages: ['token must be a test token of the chosen method'] },
      ]);
      const badMethod = await pay(testApp, customer.authorization, reference, {
        method: 'cash',
        token: 'sim_card_visa',
      });
      expectError(badMethod, 400, 'VALIDATION_FAILED');
      expect(await readPayments(testApp.knex)).toEqual([]);
    });
  });
});

/** The payment limit (design §10.6), counted per booking: here 2 in 5 minutes. */
describe('The payment rate limit (integration)', () => {
  let testApp: TestApp;
  const clock = new TestClock(NOW);

  beforeAll(async () => {
    testApp = await createTestApp({
      clock,
      config: buildTestConfig({}, { RATE_LIMIT_PAYMENT: '2/5m' }),
    });
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('answers the third payment of a booking within the window with 429 and Retry-After', async () => {
    const admin = await staffSession(testApp, 'admin');
    const showtime = await bookableShowtime(testApp, admin);
    const { customer, reference } = await customerHold(testApp, showtime.showtimeId, ['B2']);
    const declined = { method: 'card', token: 'sim_card_declined' };
    expect((await pay(testApp, customer.authorization, reference, declined)).status).toBe(201);
    expect((await pay(testApp, customer.authorization, reference, declined)).status).toBe(201);
    const limited = await pay(testApp, customer.authorization, reference, declined);
    expectError(limited, 429, 'RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

    const other = await customerHold(testApp, showtime.showtimeId, ['B3']);
    expect((await pay(testApp, other.customer.authorization, other.reference)).status).toBe(201);
    expect(await holdSeats(testApp, showtime.showtimeId, ['B4'])).toHaveProperty('status', 201);
  });
});
