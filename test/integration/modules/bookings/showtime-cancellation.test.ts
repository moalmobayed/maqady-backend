import type { Response } from 'supertest';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import { paidOnline, refundBooking } from '../../../support/admin-bookings';
import { counterSale } from '../../../support/box-office';
import { customerHold, pay, readPayments } from '../../../support/checkout';
import { TestClock } from '../../../support/clock';
import { bookableShowtime, expectHold } from '../../../support/holds';
import { readMessages } from '../../../support/messaging/messages';
import { RecordingEmailSender } from '../../../support/messaging/recording-email-sender';
import { cancelShowtime } from '../../../support/showtimes';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { BookableShowtimeFixture, StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(180_000);

const NOW = new Date('2026-10-10T10:00:00+03:00');

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

/**
 * Cancelling a showtime with bookings (design §7.7; PRD "Cancellations" 4, A5, "Email and SMS"):
 * the preview's figures, then every confirmed booking refunded on its rails, every live hold
 * released, and one cancellation notice per booking and channel, in the PATCH's transaction.
 * Real app and Postgres; only Resend is replaced.
 */
describe('Showtime cancellation (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let boxOffice: StaffSession;
  let showtime: BookableShowtimeFixture;
  let other: BookableShowtimeFixture;
  const clock = new TestClock(NOW);

  const preview = (showtimeId: number, authorization = admin.authorization) =>
    testApp
      .http()
      .get(`/api/v1/admin/showtimes/${showtimeId}/cancellation-preview`)
      .set('Authorization', authorization);
  const statusOf = async (reference: string) =>
    (
      (await testApp.knex('bookings').first('status').where({ reference })) as {
        status: string;
      }
    ).status;

  beforeAll(async () => {
    testApp = await createTestApp({
      clock,
      overrides: [{ provide: EmailSender, useValue: new RecordingEmailSender() }],
    });
    admin = await staffSession(testApp, 'admin');
    boxOffice = await staffSession(testApp, 'box_office');
  });

  beforeEach(async () => {
    clock.set(NOW);
    await testApp.knex.raw(
      'TRUNCATE booking_notes, payments, seat_claims, booking_seats, bookings, hold_refusals, audit_events, idempotency_keys, messages CASCADE',
    );
    showtime = await bookableShowtime(testApp, admin);
    other = await bookableShowtime(testApp, admin, { fixture: showtime, startTime: '22:30' });
  });

  afterAll(async () => {
    await testApp.close();
  });

  /** Every kind of booking on the showtime, and one on another showtime of the hall. */
  async function seed() {
    const abandoned = await customerHold(testApp, showtime.showtimeId, ['D5']);
    clock.advance({ minutes: 6 });
    const card = await paidOnline(testApp, showtime.showtimeId, ['B2', 'B3'], {
      phone: '01012345678',
    });
    const wallet = await paidOnline(testApp, showtime.showtimeId, ['C1'], {
      payment: { method: 'wallet', token: 'sim_wallet_apple_pay' },
    });
    const cash = await counterSale(testApp, boxOffice.authorization, showtime.showtimeId, ['D1'], {
      method: 'cash',
      customer: { kind: 'contact', fullName: 'Omar Khaled', email: 'omar.k@example.com' },
    });
    const walkIn = await counterSale(testApp, boxOffice.authorization, showtime.showtimeId, ['A2']);
    const refunded = await paidOnline(testApp, showtime.showtimeId, ['A5']);
    expect((await refundBooking(testApp, admin.authorization, refunded.reference)).status).toBe(
      201,
    );
    const hold = await expectHold(testApp, showtime.showtimeId, ['C5']);
    const slow = await customerHold(testApp, showtime.showtimeId, ['C7']);
    const processing = await pay(testApp, slow.customer.authorization, slow.reference, {
      method: 'card',
      token: 'sim_card_slow',
    });
    expect(processing.body.payment.status).toBe('processing');
    const elsewhere = await paidOnline(testApp, other.showtimeId, ['B2']);
    return {
      abandoned: abandoned.reference,
      card,
      wallet,
      cash: cash.body.booking.reference as string,
      walkIn: walkIn.body.booking.reference as string,
      refunded: refunded.reference,
      hold: hold.reference,
      slow,
      elsewhere,
    };
  }

  it('previews the impact: bookings, seats, refunds by rail, holds and messages', async () => {
    await seed();
    const response = await preview(showtime.showtimeId);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      showtimeId: showtime.showtimeId,
      cancellable: true,
      bookingCount: 4,
      seatCount: 5,
      refundedOnline: { amount: 2 * 19000 + 19000, currency: 'EGP' },
      owedAtCounter: { amount: 23000 + 15000, currency: 'EGP' },
      liveHoldCount: 2,
      emailCount: 3,
      smsCount: 1,
    });
    expectError(await preview(999999), 404, 'NOT_FOUND');
  });

  it('refunds every booking, releases every live hold and tells every ticket holder', async () => {
    const seeded = await seed();
    const before = (await readMessages(testApp.knex)).length;
    await cancelShowtime(testApp, admin, showtime.showtimeId);
    const cancelled = (await testApp
      .knex('showtimes')
      .first('status')
      .where({ id: showtime.showtimeId })) as { status: string };
    expect(cancelled.status).toBe('cancelled');

    for (const reference of [
      seeded.card.reference,
      seeded.wallet.reference,
      seeded.cash,
      seeded.walkIn,
    ]) {
      expect(await statusOf(reference)).toBe('refunded');
    }
    expect(await statusOf(seeded.elsewhere.reference)).toBe('confirmed');
    const refunds = await testApp
      .knex('payments')
      .select<{ method: string; status: string; amount: number }[]>('method', 'status', 'amount')
      .where({ kind: 'refund', purpose: 'cancellation' })
      .orderBy('id');
    // The earlier refund of A5, then one per charge of the four bookings.
    expect(refunds.map((row) => [row.method, row.status, row.amount])).toEqual([
      ['card', 'succeeded', 15000],
      ['card', 'succeeded', 38000],
      ['wallet', 'succeeded', 19000],
      ['cash', 'pending', 23000],
      ['cash', 'pending', 15000],
    ]);
    // No live claim is left on the showtime: sold seats refunded, held seats released (the
    // abandoned hold's claim had already ended, which frees a seat as well as deleting it).
    const live = await testApp
      .knex('seat_claims')
      .where({ showtime_id: showtime.showtimeId })
      .andWhere((query) => {
        void query.whereNull('claimed_until').orWhere('claimed_until', '>', clock.now());
      });
    expect(live).toEqual([]);
    const hold = (await testApp
      .knex('bookings')
      .first('status', 'hold_expires_at')
      .where({ reference: seeded.hold })) as { status: string; hold_expires_at: Date };
    expect(hold).toEqual({ status: 'held', hold_expires_at: clock.now() });

    const queued = (await readMessages(testApp.knex)).slice(before);
    expect(queued.map((message) => [message.template, message.channel]).sort()).toEqual([
      ['showtime.cancelled', 'email'],
      ['showtime.cancelled', 'email'],
      ['showtime.cancelled', 'email'],
      ['showtime.cancelled_sms', 'sms'],
    ]);
    // One message per booking and channel, each naming its booking.
    const perBooking = new Map<string, number>();
    for (const message of queued) {
      const key = `${message.related_booking_id}:${message.channel}`;
      perBooking.set(key, (perBooking.get(key) ?? 0) + 1);
    }
    expect([...perBooking.values()].every((count) => count === 1)).toBe(true);
    expect(queued.find((m) => m.channel === 'sms')?.recipient).toBe('+201012345678');
    const cashEmail = queued.find((m) => m.recipient === 'omar.k@example.com');
    expect(cashEmail?.body_text).toContain('is waiting for you at the box office');

    const audit = (await testApp
      .knex('audit_events')
      .first('metadata')
      .where({ action: 'showtime.cancelled', entity_id: showtime.showtimeId })) as {
      metadata: Record<string, unknown>;
    };
    expect(audit.metadata).toMatchObject({
      refundedBookingCount: 4,
      releasedHoldCount: 2,
      notifiedCount: 3,
    });
    const page = await testApp
      .http()
      .get(`/api/v1/bookings/${seeded.card.reference}`)
      .set('Authorization', seeded.card.authorization);
    expect(page.body).toMatchObject({
      status: 'refunded',
      refund: { amount: { amount: 38000, currency: 'EGP' } },
    });
    const after = await preview(showtime.showtimeId);
    expect(after.body).toMatchObject({ cancellable: false, bookingCount: 0, liveHoldCount: 0 });
  });

  it('refunds a payment that succeeds after its showtime was cancelled', async () => {
    const seeded = await seed();
    await cancelShowtime(testApp, admin, showtime.showtimeId);
    clock.advance({ seconds: 11 });
    const page = await testApp
      .http()
      .get(`/api/v1/bookings/${seeded.slow.reference}`)
      .set('Authorization', seeded.slow.customer.authorization);
    expect(page.body.status).toBe('refunded');
    const payments = await readPayments(testApp.knex, seeded.slow.bookingId);
    expect(payments.map((row) => [row.kind, row.status])).toEqual([
      ['charge', 'succeeded'],
      ['refund', 'succeeded'],
    ]);
  });

  it('cancels a showtime with no bookings', async () => {
    expect((await preview(other.showtimeId)).body).toMatchObject({
      bookingCount: 0,
      emailCount: 0,
    });
    await cancelShowtime(testApp, admin, other.showtimeId);
  });
});
