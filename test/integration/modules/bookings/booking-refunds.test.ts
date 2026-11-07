import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { SQLSTATE } from '../../../../src/common/database/postgres-errors';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import {
  editBooking,
  paidOnline,
  payOutRefund,
  refundBooking,
} from '../../../support/admin-bookings';
import { counterSale } from '../../../support/box-office';
import { customerHold, readPayments } from '../../../support/checkout';
import { TestClock } from '../../../support/clock';
import { waitForLockWaiters } from '../../../support/database';
import { bookableShowtime, expectHold, holdSeats } from '../../../support/holds';
import { readMessages } from '../../../support/messaging/messages';
import { RecordingEmailSender } from '../../../support/messaging/recording-email-sender';
import { signInStaff, staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { BookableShowtimeFixture, StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(180_000);

const NOW = new Date('2026-10-10T10:00:00+03:00');

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

/**
 * Cancel & refund and payouts (design §7.7; PRD "Cancellations" 2–3): every charge refunded once,
 * for what is left of it, on its own rail, even when the request is retried or raced. Real app and
 * Postgres; only Resend is replaced.
 */
describe('Cancel and refund (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let boxOffice: StaffSession;
  let showtime: BookableShowtimeFixture;
  const clock = new TestClock(NOW);
  const deadlocks: unknown[] = [];
  const onQueryError = (error: { code?: string }) => {
    if (error.code === SQLSTATE.DEADLOCK_DETECTED) deadlocks.push(error);
  };

  const bookingOf = (reference: string) =>
    testApp
      .knex('bookings')
      .first('id', 'status', 'refunded_at', 'qr_version')
      .where({ reference });
  const claimsOf = (bookingId: number) =>
    testApp.knex('seat_claims').select('seat_label').where({ booking_id: bookingId });

  beforeAll(async () => {
    testApp = await createTestApp({
      clock,
      overrides: [{ provide: EmailSender, useValue: new RecordingEmailSender() }],
    });
    admin = await staffSession(testApp, 'admin');
    boxOffice = await staffSession(testApp, 'box_office');
    showtime = await bookableShowtime(testApp, admin);
    testApp.knex.on('query-error', onQueryError);
  });

  beforeEach(async () => {
    clock.set(NOW);
    deadlocks.length = 0;
    await testApp.knex.raw(
      'TRUNCATE booking_notes, payments, seat_claims, booking_seats, bookings, hold_refusals, audit_events, idempotency_keys, messages CASCADE',
    );
  });

  afterAll(async () => {
    testApp.knex.off('query-error', onQueryError);
    await testApp.close();
  });

  it('refunds an online booking through the provider, releases its seats and emails the customer', async () => {
    const paid = await paidOnline(testApp, showtime.showtimeId, ['B2', 'B3']);
    clock.advance({ minutes: 1 });
    const response = await refundBooking(testApp, admin.authorization, paid.reference);

    expect(response.status).toBe(201);
    expect(response.body.refunds).toEqual([
      expect.objectContaining({
        kind: 'refund',
        purpose: 'cancellation',
        method: 'card',
        status: 'succeeded',
        amount: { amount: 38000, currency: 'EGP' },
        refundable: null,
        completedAt: '2026-10-10T10:01:00+03:00',
      }),
    ]);
    expect(response.body.booking).toMatchObject({
      reference: paid.reference,
      status: 'refunded',
      paymentStatus: 'refunded',
      ticket: null,
      refund: {
        amount: { amount: 38000, currency: 'EGP' },
        refundedAt: '2026-10-10T10:01:00+03:00',
      },
    });
    const payments = await readPayments(testApp.knex, paid.bookingId);
    expect(
      payments.map((row) => [row.kind, row.status, row.amount, row.provider_idempotency_key]),
    ).toEqual([
      ['charge', 'succeeded', 38000, `${paid.reference}-c1`],
      ['refund', 'succeeded', 38000, `${paid.reference}-r1`],
    ]);
    expect(payments[1]!.refund_of_payment_id).toBe(payments[0]!.id);
    expect(await claimsOf(paid.bookingId)).toEqual([]);
    // The seats can be held again at once.
    expect((await holdSeats(testApp, showtime.showtimeId, ['B2', 'B3'])).status).toBe(201);

    const emails = (await readMessages(testApp.knex)).filter(
      (m) => m.template === 'booking.refunded',
    );
    expect(emails).toHaveLength(1);
    expect(emails[0]!.related_booking_id).toBe(paid.bookingId);
    expect(emails[0]!.body_text).toContain('refunded in full: EGP 380');
    expect(emails[0]!.body_text).toContain('goes back to the card or wallet');

    const audit = await testApp
      .knex('audit_events')
      .select('action', 'actor_kind', 'actor_staff_user_id', 'metadata')
      .where({ booking_id: paid.bookingId })
      .whereIn('action', ['booking.refunded', 'payment.refunded'])
      .orderBy('id');
    expect(audit).toEqual([
      {
        action: 'payment.refunded',
        actor_kind: 'staff',
        actor_staff_user_id: admin.staffUserId,
        metadata: expect.objectContaining({ method: 'card', status: 'succeeded', amount: 38000 }),
      },
      {
        action: 'booking.refunded',
        actor_kind: 'staff',
        actor_staff_user_id: admin.staffUserId,
        metadata: {
          showtimeId: showtime.showtimeId,
          reason: 'admin_cancel',
          seatCount: 2,
          amount: 38000,
        },
      },
    ]);
    const history = await testApp
      .http()
      .get(`/api/v1/bookings/${paid.reference}/history`)
      .set('Authorization', paid.authorization);
    expect((history.body.items as { kind: string }[]).map((event) => event.kind)).toContain(
      'refunded',
    );
  });

  it('refunds a counter cash sale as pending, then records the payout once', async () => {
    const sale = await counterSale(testApp, boxOffice.authorization, showtime.showtimeId, ['C4'], {
      method: 'cash',
      customer: { kind: 'contact', fullName: 'Omar Khaled', email: 'omar.k@example.com' },
    });
    const reference = sale.body.booking.reference as string;
    const response = await refundBooking(testApp, admin.authorization, reference);
    expect(response.status).toBe(201);
    const [refund] = response.body.refunds as {
      id: number;
      status: string;
      completedAt: unknown;
    }[];
    expect(refund).toMatchObject({
      method: 'cash',
      status: 'pending',
      completedAt: null,
      paidOutAt: null,
    });
    const email = (await readMessages(testApp.knex)).find((m) => m.template === 'booking.refunded');
    expect(email?.body_text).toContain('is waiting for you at the box office');

    clock.advance({ minutes: 30 });
    const later = await signInStaff(testApp, admin.email, admin.password);
    const payout = await payOutRefund(testApp, later.authorization, refund!.id);
    expect(payout.status).toBe(201);
    expect(payout.body).toMatchObject({
      id: refund!.id,
      kind: 'refund',
      status: 'succeeded',
      completedAt: '2026-10-10T10:30:00+03:00',
      paidOutAt: '2026-10-10T10:30:00+03:00',
      paidOutBy: { id: admin.staffUserId },
    });
    const again = await payOutRefund(testApp, later.authorization, refund!.id);
    expectError(again, 409, 'REFUND_NOT_PENDING');
    expect(again.body.error.details).toEqual({ status: 'succeeded' });
    const audit = await testApp.knex('audit_events').where({ action: 'payment.paid_out' });
    expect(audit).toHaveLength(1);
  });

  it('refuses to pay out an online refund, a charge or an unknown id', async () => {
    const paid = await paidOnline(testApp, showtime.showtimeId, ['A2']);
    const refund = await refundBooking(testApp, admin.authorization, paid.reference);
    const online = refund.body.refunds[0].id as number;
    const charge = (await readPayments(testApp.knex, paid.bookingId)).find(
      (row) => row.kind === 'charge',
    )!;
    expectError(
      await payOutRefund(testApp, admin.authorization, online),
      409,
      'REFUND_NOT_PENDING',
    );
    expectError(await payOutRefund(testApp, admin.authorization, charge.id), 404, 'NOT_FOUND');
    expectError(await payOutRefund(testApp, admin.authorization, 999999), 404, 'NOT_FOUND');
    expectError(
      await testApp
        .http()
        .post(`/api/v1/admin/refunds/${online}/payouts`)
        .set('Authorization', admin.authorization)
        .send(),
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  });

  it('refunds each charge once when the same request is retried', async () => {
    const paid = await paidOnline(testApp, showtime.showtimeId, ['B5']);
    const key = randomUUID();
    const first = await refundBooking(testApp, admin.authorization, paid.reference, key);
    const replay = await refundBooking(testApp, admin.authorization, paid.reference, key);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    const another = await refundBooking(testApp, admin.authorization, paid.reference);
    expectError(another, 409, 'BOOKING_NOT_REFUNDABLE');
    expect(another.body.error.details).toEqual({ status: 'refunded' });
    const refunds = (await readPayments(testApp.knex, paid.bookingId)).filter(
      (r) => r.kind === 'refund',
    );
    expect(refunds).toHaveLength(1);
    expect(
      (await readMessages(testApp.knex)).filter((m) => m.template === 'booking.refunded'),
    ).toHaveLength(1);
  });

  it('refunds each charge once when two admins race', async () => {
    const paid = await paidOnline(testApp, showtime.showtimeId, ['B6', 'B7']);
    const otherAdmin = await staffSession(testApp, 'admin');
    // Hold the booking's row so both requests queue on it, then let them go together.
    const trx = await testApp.knex.transaction();
    let responses: Response[];
    try {
      await trx('bookings').where({ id: paid.bookingId }).forUpdate().first('id');
      // Promise.all starts both requests now; supertest sends a request only once awaited.
      const racing = Promise.all([
        refundBooking(testApp, admin.authorization, paid.reference),
        refundBooking(testApp, otherAdmin.authorization, paid.reference),
      ]);
      await waitForLockWaiters(testApp.knex, 2);
      await trx.commit();
      responses = await racing;
    } finally {
      if (!trx.isCompleted()) await trx.rollback();
    }

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(responses.find((r) => r.status === 409)!.body.error.code).toBe('BOOKING_NOT_REFUNDABLE');
    const refunds = (await readPayments(testApp.knex, paid.bookingId)).filter(
      (r) => r.kind === 'refund',
    );
    expect(refunds).toHaveLength(1);
    expect(refunds[0]!.amount).toBe(38000);
    expect(deadlocks).toEqual([]);
  });

  it('refunds every charge for what is left of it, on its own rail', async () => {
    // A1 front (150) paid by card, then moved to D1 (back, 230): 80 more collected in cash.
    const paid = await paidOnline(testApp, showtime.showtimeId, ['A3']);
    const edited = await editBooking(testApp, admin.authorization, paid.reference, {
      seats: ['D1'],
      reason: 'seat_problem',
      payment: { method: 'cash' },
    });
    expect(edited.status).toBe(201);
    const response = await refundBooking(testApp, admin.authorization, paid.reference);
    expect(response.status).toBe(201);
    expect(
      (response.body.refunds as { method: string; status: string; amount: { amount: number } }[])
        .map((refund) => [refund.method, refund.status, refund.amount.amount])
        .sort(),
    ).toEqual([
      ['card', 'succeeded', 15000],
      ['cash', 'pending', 8000],
    ]);
    expect(response.body.booking.refund.amount).toEqual({ amount: 23000, currency: 'EGP' });
  });

  it('refuses a booking that is not confirmed now', async () => {
    const hold = await expectHold(testApp, showtime.showtimeId, ['C8']);
    const held = await refundBooking(testApp, admin.authorization, hold.reference);
    expectError(held, 409, 'BOOKING_NOT_REFUNDABLE');
    expect(held.body.error.details).toEqual({ status: 'held' });

    const abandoned = await customerHold(testApp, showtime.showtimeId, ['C7']);
    const paid = await paidOnline(testApp, showtime.showtimeId, ['C6']);
    clock.set(new Date(showtime.startsAt.getTime() + 3 * 60 * 60 * 1000));
    const later = await signInStaff(testApp, admin.email, admin.password);
    const completed = await refundBooking(testApp, later.authorization, paid.reference);
    expectError(completed, 409, 'BOOKING_NOT_REFUNDABLE');
    expect(completed.body.error.details).toEqual({ status: 'completed' });
    const ended = await refundBooking(testApp, later.authorization, abandoned.reference);
    expect(ended.body.error.details).toEqual({ status: 'abandoned' });
    expectError(await refundBooking(testApp, later.authorization, 'MQ-ZZZZZZ'), 404, 'NOT_FOUND');
    expect(await testApp.knex('payments').where({ kind: 'refund' })).toHaveLength(0);
    const row = await bookingOf(paid.reference);
    expect(row?.status).toBe('confirmed');
  });

  it('refunds a booking mid-show: the showtime started but has not ended', async () => {
    const paid = await paidOnline(testApp, showtime.showtimeId, ['C3']);
    clock.set(new Date(showtime.startsAt.getTime() + 30 * 60 * 1000));
    const later = await signInStaff(testApp, admin.email, admin.password);
    expect((await refundBooking(testApp, later.authorization, paid.reference)).status).toBe(201);
  });
});
