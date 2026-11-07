import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { SettlementService } from '../../../../src/modules/bookings/settlement.service';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import { customerHold, pay, readPayments } from '../../../support/checkout';
import { TestClock } from '../../../support/clock';
import { registerCustomer } from '../../../support/customer-auth';
import { bookableShowtime, expectHold, holdSeats, seatMapClient } from '../../../support/holds';
import { RecordingEmailSender } from '../../../support/messaging/recording-email-sender';
import { cancelShowtime } from '../../../support/showtimes';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type {
  BookableShowtimeFixture,
  CustomerHoldFixture,
  StaffSession,
  TestApp,
} from '../../../support/types';

jest.setTimeout(180_000);

const NOW = new Date('2026-10-10T10:00:00+03:00');
const SLOW = { method: 'card', token: 'sim_card_slow' };
const SLOW_DECLINED = { method: 'card', token: 'sim_card_slow_declined' };

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

/**
 * Settlement on read and on write (design §7.1 step 1, §7.5; PRD Seats 5, C9 "Confirming your
 * payment"): a slow simulated payment is finished from its stored `settles_at` by whichever
 * request next reads or writes its booking or showtime, never by a timer, exactly once, and the
 * state it reaches does not depend on which request that was. Real app, real Postgres, the clock
 * moved by hand.
 */
describe('Settlement (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let showtime: BookableShowtimeFixture;
  const clock = new TestClock(NOW);

  const getBooking = (reference: string, authorization: string) =>
    testApp.http().get(`/api/v1/bookings/${reference}`).set('Authorization', authorization);
  const stored = (bookingId: number) =>
    testApp
      .knex('bookings')
      .select<
        {
          status: string;
          hold_expires_at: Date;
          confirmed_at: Date | null;
          refunded_at: Date | null;
          qr_version: number | null;
          has_declined_payment: boolean;
        }[]
      >(
        'status',
        'hold_expires_at',
        'confirmed_at',
        'refunded_at',
        'qr_version',
        'has_declined_payment',
      )
      .where({ id: bookingId })
      .first();
  const claimsOf = (bookingId: number) =>
    testApp
      .knex('seat_claims')
      .select<{ seat_label: string; claimed_until: Date | null }[]>('seat_label', 'claimed_until')
      .where({ booking_id: bookingId })
      .orderBy('seat_label');
  const auditOf = async (bookingId: number) =>
    testApp
      .knex('audit_events')
      .select<{ action: string; actor_kind: string; metadata: Record<string, unknown> }[]>(
        'action',
        'actor_kind',
        'metadata',
      )
      .where({ booking_id: bookingId })
      .orderBy('id');
  const templatesOf = async (bookingId: number): Promise<string[]> =>
    (
      await testApp
        .knex('messages')
        .select<{ template: string }[]>('template')
        .where({ related_booking_id: bookingId })
        .orderBy('id')
    ).map((row) => row.template);

  /** A booking's rows with ids, references and instants made comparable between two bookings. */
  const normalised = async (bookingId: number) => ({
    booking: await stored(bookingId),
    payments: (await readPayments(testApp.knex, bookingId)).map((row) => ({
      kind: row.kind,
      status: row.status,
      completed_at: row.completed_at,
      settles_at: row.settles_at,
    })),
    claims: (await claimsOf(bookingId)).map((claim) => claim.claimed_until),
    messages: await templatesOf(bookingId),
    audit: (await auditOf(bookingId)).map((row) => [row.action, row.actor_kind]),
  });

  const slowHold = async (seats: string[], token = SLOW): Promise<CustomerHoldFixture> => {
    const fixture = await customerHold(testApp, showtime.showtimeId, seats);
    const response = await pay(testApp, fixture.customer.authorization, fixture.reference, token);
    expect(response.status).toBe(201);
    expect(response.body.payment.status).toBe('processing');
    return fixture;
  };

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

  it('answers a slow payment with processing and keeps the hold when it lasts longer anyway', async () => {
    const { customer, reference, bookingId } = await customerHold(testApp, showtime.showtimeId, [
      'B2',
    ]);
    const response = await pay(testApp, customer.authorization, reference, SLOW);
    expect(response.status).toBe(201);
    expect(response.body.payment).toMatchObject({
      status: 'processing',
      card: { brand: 'visa', last4: '3184' },
      completedAt: null,
      settlesAt: '2026-10-10T10:00:10+03:00',
    });
    expect(response.body.booking).toMatchObject({
      status: 'held',
      paymentStatus: 'processing',
      holdExpiresAt: '2026-10-10T10:05:00+03:00',
      ticket: null,
    });
    expect((await stored(bookingId))!.hold_expires_at).toEqual(
      new Date('2026-10-10T10:05:00+03:00'),
    );
  });

  it('extends a hold about to end until the result is in plus 30 seconds, and announces it', async () => {
    const { customer, reference, bookingId } = await customerHold(testApp, showtime.showtimeId, [
      'B3',
      'B4',
    ]);
    const map = await seatMapClient(testApp);
    map.send('subscribe', { showtimeId: showtime.showtimeId });
    expect((await map.next()).event).toBe('snapshot');
    clock.advance({ minutes: 4, seconds: 50 });

    const response = await pay(testApp, customer.authorization, reference, SLOW);

    const until = new Date('2026-10-10T10:05:30+03:00');
    expect(response.body.booking.holdExpiresAt).toBe('2026-10-10T10:05:30+03:00');
    expect((await stored(bookingId))!.hold_expires_at).toEqual(until);
    expect(await claimsOf(bookingId)).toEqual([
      { seat_label: 'B3', claimed_until: until },
      { seat_label: 'B4', claimed_until: until },
    ]);
    expect(await map.next()).toEqual({
      event: 'seat.held',
      data: {
        showtimeId: showtime.showtimeId,
        labels: ['B3', 'B4'],
        heldUntil: '2026-10-10T10:05:30+03:00',
      },
    });
    // Past the original end the seats are still the customer's: a rival is refused.
    clock.advance({ seconds: 20 });
    const rival = await holdSeats(testApp, showtime.showtimeId, ['B3']);
    expectError(rival, 409, 'SEAT_TAKEN');
    await map.close();
  });

  it('settles on the first read at settlesAt, not 1 ms before: confirmed, tickets queued, seat.booked', async () => {
    const { customer, reference, bookingId } = await slowHold(['C2', 'C3']);
    const map = await seatMapClient(testApp);
    map.send('subscribe', { showtimeId: showtime.showtimeId });
    expect((await map.next()).event).toBe('snapshot');

    clock.advance({ seconds: 10, milliseconds: -1 });
    const early = await getBooking(reference, customer.authorization);
    expect(early.body).toMatchObject({ status: 'held', paymentStatus: 'processing' });
    expect(early.body.payment.settlesAt).toBe('2026-10-10T10:00:10+03:00');

    clock.advance({ milliseconds: 1 });
    const settled = await getBooking(reference, customer.authorization);
    expect(settled.body).toMatchObject({
      status: 'confirmed',
      paymentStatus: 'paid',
      confirmedAt: '2026-10-10T10:00:10+03:00',
      payment: { status: 'succeeded', completedAt: '2026-10-10T10:00:10+03:00', settlesAt: null },
      ticket: { admits: 2 },
    });
    expect(await claimsOf(bookingId)).toEqual([
      { seat_label: 'C2', claimed_until: null },
      { seat_label: 'C3', claimed_until: null },
    ]);
    expect(await templatesOf(bookingId)).toEqual(['booking.tickets']);
    expect((await auditOf(bookingId)).map((row) => [row.action, row.actor_kind])).toEqual([
      ['booking.held', 'customer'],
      ['payment.processing', 'customer'],
      // The charge's result first, then the confirmation it caused (U12: History order).
      ['payment.succeeded', 'system'],
      ['booking.confirmed', 'system'],
    ]);
    expect(await map.next()).toEqual({
      event: 'seat.booked',
      data: { showtimeId: showtime.showtimeId, labels: ['C2', 'C3'] },
    });
    await map.close();
  });

  it('reaches the same state whether a read or a write settles it', async () => {
    const read = await slowHold(['D2']);
    const write = await slowHold(['D3']);
    clock.advance({ seconds: 15 });

    // Settled by its owner reading it: the other booking is not in that read's scope.
    expect((await getBooking(read.reference, read.customer.authorization)).body.status).toBe(
      'confirmed',
    );
    expect((await stored(write.bookingId))!.status).toBe('held');
    // Settled by another customer's hold on the same showtime.
    const other = await registerCustomer(testApp);
    expect(
      (
        await holdSeats(testApp, showtime.showtimeId, ['A5'], {
          authorization: other.authorization,
        })
      ).status,
    ).toBe(201);

    const byRead = await normalised(read.bookingId);
    const byWrite = await normalised(write.bookingId);
    expect(byWrite).toEqual(byRead);
    expect(byRead.booking).toMatchObject({ status: 'confirmed', qr_version: 1 });
    expect(byRead.payments).toEqual([
      expect.objectContaining({ kind: 'charge', status: 'succeeded' }),
    ]);
  });

  it("settles a booking's due payment even behind a full batch of other due payments nobody read", async () => {
    // 101 processing charges of other bookings, due before the target's and outside its scope
    // (abandoned slow payments whose booking and showtime nobody touched since).
    const stale = await slowHold(['A8']);
    const [template] = await testApp
      .knex('bookings')
      .select<Record<string, unknown>[]>('*')
      .where({ id: stale.bookingId });
    const [charge] = await testApp
      .knex('payments')
      .select<Record<string, unknown>[]>('*')
      .where({ booking_id: stale.bookingId });
    const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    const references = Array.from(
      { length: 100 },
      (_, index) =>
        `MQ-ZZZZ${alphabet[Math.floor(index / alphabet.length)]}${alphabet[index % alphabet.length]}`,
    );
    const clones = await testApp
      .knex('bookings')
      .insert(references.map((reference) => ({ ...template, id: undefined, reference })))
      .returning<{ id: number; reference: string }[]>(['id', 'reference']);
    await testApp.knex('payments').insert(
      clones.map((clone) => ({
        ...charge,
        id: undefined,
        booking_id: clone.id,
        provider_idempotency_key: `${clone.reference}-c1`,
      })),
    );

    clock.advance({ seconds: 1 });
    const target = await slowHold(['C8']);
    clock.advance({ seconds: 10 });

    const settled = await getBooking(target.reference, target.customer.authorization);
    expect(settled.body).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });
    // The other bookings stay outside this read's scope.
    expect((await stored(stale.bookingId))!.status).toBe('held');
  });

  it('settles once when 10 reads race after the result is due', async () => {
    const { customer, reference, bookingId } = await slowHold(['C5']);
    clock.advance({ seconds: 11 });
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => getBooking(reference, customer.authorization)),
    );
    expect(responses.map((response) => String(response.body.status))).toEqual(
      Array(10).fill('confirmed'),
    );
    const audit = await auditOf(bookingId);
    expect(audit.filter((row) => row.action === 'booking.confirmed')).toHaveLength(1);
    expect(audit.filter((row) => row.action === 'payment.succeeded')).toHaveLength(1);
    expect(await templatesOf(bookingId)).toEqual(['booking.tickets']);
    expect(await readPayments(testApp.knex, bookingId)).toHaveLength(1);
  });

  it('settles a slow decline as declined and leaves the hold payable until it ends', async () => {
    const { customer, reference, bookingId } = await slowHold(['C6'], SLOW_DECLINED);
    clock.advance({ seconds: 10 });
    const declined = await getBooking(reference, customer.authorization);
    expect(declined.body).toMatchObject({
      status: 'held',
      paymentStatus: 'declined',
      payment: { status: 'declined', card: { brand: 'visa', last4: '0341' } },
    });
    expect((await stored(bookingId))!.has_declined_payment).toBe(true);

    const paid = await pay(testApp, customer.authorization, reference);
    expect(paid.status).toBe(201);
    expect(paid.body.booking.status).toBe('confirmed');
  });

  it('still confirms a payment settled long after its hold and claims ended, while nobody took the seats', async () => {
    const { customer, reference, bookingId } = await slowHold(['C7']);
    clock.advance({ minutes: 10 });
    const settled = await getBooking(reference, customer.authorization);
    expect(settled.body).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });
    expect(await claimsOf(bookingId)).toEqual([{ seat_label: 'C7', claimed_until: null }]);
  });

  it('refunds a success at once when the booking lost a seat meanwhile', async () => {
    const { customer, reference, bookingId } = await slowHold(['D4', 'D5']);
    const map = await seatMapClient(testApp);
    map.send('subscribe', { showtimeId: showtime.showtimeId });
    expect((await map.next()).event).toBe('snapshot');
    // Another hold owns D5 now (as only a slow real provider could make happen).
    const rival = await expectHold(testApp, showtime.showtimeId, ['A7']);
    expect((await map.next()).event).toBe('seat.held');
    const rivalRow = await testApp
      .knex('bookings')
      .select<{ id: number }[]>('id')
      .where({ reference: rival.reference })
      .first();
    await testApp
      .knex('seat_claims')
      .where({ showtime_id: showtime.showtimeId, seat_label: 'D5' })
      .update({ booking_id: rivalRow!.id });
    clock.advance({ seconds: 10 });

    const refunded = await getBooking(reference, customer.authorization);
    expect(refunded.body).toMatchObject({
      status: 'refunded',
      paymentStatus: 'refunded',
      ticket: null,
      payment: { status: 'succeeded' },
    });
    const [charge, refund] = await readPayments(testApp.knex, bookingId);
    expect(charge).toMatchObject({ kind: 'charge', status: 'succeeded' });
    expect(refund).toMatchObject({
      kind: 'refund',
      purpose: 'cancellation',
      status: 'succeeded',
      amount: charge!.amount,
      refund_of_payment_id: charge!.id,
      provider_idempotency_key: `${reference}-r1`,
    });
    expect(await stored(bookingId)).toMatchObject({
      status: 'refunded',
      confirmed_at: clock.now(),
      refunded_at: clock.now(),
    });
    expect(await claimsOf(bookingId)).toEqual([]);
    expect(await map.next()).toEqual({
      event: 'seat.released',
      data: { showtimeId: showtime.showtimeId, labels: ['D4'] },
    });
    const audit = await auditOf(bookingId);
    expect(audit.find((row) => row.action === 'booking.refunded')).toMatchObject({
      actor_kind: 'system',
      metadata: { reason: 'claims_lost', seatCount: 2, showtimeId: showtime.showtimeId },
    });
    expect(audit.map((row) => row.action)).toContain('payment.refunded');
    expect(await templatesOf(bookingId)).toEqual([]);
    await map.close();
  });

  it('refunds a success at once when its showtime was cancelled meanwhile', async () => {
    const other = await bookableShowtime(testApp, admin, { fixture: showtime, startTime: '15:00' });
    const fixture = await customerHold(testApp, other.showtimeId, ['B6']);
    const processing = await pay(testApp, fixture.customer.authorization, fixture.reference, SLOW);
    expect(processing.body.payment.status).toBe('processing');
    await cancelShowtime(testApp, admin, other.showtimeId);
    clock.advance({ seconds: 10 });

    const refunded = await getBooking(fixture.reference, fixture.customer.authorization);
    expect(refunded.body).toMatchObject({ status: 'refunded', paymentStatus: 'refunded' });
    const audit = await auditOf(fixture.bookingId);
    expect(audit.find((row) => row.action === 'booking.refunded')?.metadata).toMatchObject({
      reason: 'showtime_cancelled',
    });
    expect(await claimsOf(fixture.bookingId)).toEqual([]);
  });

  it('never releases or replaces a hold whose payment is processing (PAYMENT_IN_PROGRESS); once settled it is paid', async () => {
    const { customer, reference, bookingId } = await slowHold(['A2']);
    const release = () =>
      testApp
        .http()
        .delete(`/api/v1/holds/${reference}`)
        .set('Authorization', customer.authorization);
    expectError(await release(), 409, 'PAYMENT_IN_PROGRESS');
    expectError(
      await holdSeats(testApp, showtime.showtimeId, ['A3'], {
        authorization: customer.authorization,
      }),
      409,
      'PAYMENT_IN_PROGRESS',
    );
    const guest = await expectHold(testApp, showtime.showtimeId, ['A4']);
    const claim = await testApp
      .http()
      .post(`/api/v1/holds/${guest.reference}/claims`)
      .set('Authorization', customer.authorization)
      .set('X-Hold-Token', guest.holdCode!)
      .set('Idempotency-Key', randomUUID())
      .send();
    expectError(claim, 409, 'PAYMENT_IN_PROGRESS');
    expect((await stored(bookingId))!.hold_expires_at).toEqual(
      new Date('2026-10-10T10:05:00+03:00'),
    );

    clock.advance({ seconds: 10 });
    // The release settles first, so it finds the booking paid.
    expectError(await release(), 409, 'ALREADY_PAID');
  });

  it('settles every due payment at once for the admin screens (settleAllDue)', async () => {
    const first = await slowHold(['B7']);
    const second = await slowHold(['B8'], SLOW_DECLINED);
    clock.advance({ seconds: 10 });
    const result = await testApp.app.get(SettlementService).settleAllDue();
    expect(result).toEqual({ confirmed: 1, declined: 1, refunded: 0 });
    expect((await stored(first.bookingId))!.status).toBe('confirmed');
    expect((await stored(second.bookingId))!.has_declined_payment).toBe(true);
    expect(await testApp.app.get(SettlementService).settleAllDue()).toEqual({
      confirmed: 0,
      declined: 0,
      refunded: 0,
    });
  });
});
