import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import {
  editBooking,
  paidOnline,
  previewEdit,
  refundBooking,
} from '../../../support/admin-bookings';
import { scanTicket } from '../../../support/box-office';
import { readPayments } from '../../../support/checkout';
import { TestClock } from '../../../support/clock';
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
 * Booking edits (design §7.8; PRD "Cancellations, refunds and edits" 5–6): the preview is the
 * edit, a lower total refunds exactly the difference, a higher one is taken at the counter, seats
 * move atomically under the claim lock order and the old QR code stops working. Real app and
 * Postgres; only Resend is replaced.
 */
describe('Booking edits (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let showtime: BookableShowtimeFixture;
  let later: BookableShowtimeFixture;
  let otherMovie: BookableShowtimeFixture;
  const clock = new TestClock(NOW);

  const bookingRow = (reference: string) =>
    testApp
      .knex('bookings')
      .first(
        'id',
        'showtime_id',
        'status',
        'seat_count',
        'total_amount',
        'qr_version',
        'contact_name',
        'contact_phone',
      )
      .where({ reference });
  const claimsOf = (bookingId: number) =>
    testApp
      .knex('seat_claims')
      .select<{ showtime_id: number; seat_label: string; claimed_until: Date | null }[]>(
        'showtime_id',
        'seat_label',
        'claimed_until',
      )
      .where({ booking_id: bookingId })
      .orderBy('seat_label');
  const seatsOf = (bookingId: number) =>
    testApp
      .knex('booking_seats')
      .select('seat_label', 'price')
      .where({ booking_id: bookingId })
      .orderBy('seat_label');

  beforeAll(async () => {
    testApp = await createTestApp({
      clock,
      overrides: [{ provide: EmailSender, useValue: new RecordingEmailSender() }],
    });
    admin = await staffSession(testApp, 'admin');
    showtime = await bookableShowtime(testApp, admin);
    later = await bookableShowtime(testApp, admin, { fixture: showtime, startTime: '22:00' });
    otherMovie = await bookableShowtime(testApp, admin);
  });

  beforeEach(async () => {
    clock.set(NOW);
    await testApp.knex.raw(
      'TRUNCATE booking_notes, payments, seat_claims, booking_seats, bookings, hold_refusals, audit_events, idempotency_keys, messages CASCADE',
    );
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('applies exactly what the preview showed, refunding only the difference', async () => {
    const paid = await paidOnline(testApp, showtime.showtimeId, ['B2', 'B3']);
    const before = await bookingRow(paid.reference);
    const body = { seats: ['A3', 'A2'], reason: 'customer_request' };

    const preview = await previewEdit(testApp, admin.authorization, paid.reference, body);
    expect(preview.status).toBe(200);
    const [charge] = await readPayments(testApp.knex, paid.bookingId);
    expect(preview.body).toMatchObject({
      current: { total: { amount: 38000, currency: 'EGP' } },
      proposed: {
        showtime: { id: showtime.showtimeId },
        total: { amount: 30000, currency: 'EGP' },
      },
      difference: { direction: 'refund', amount: { amount: 8000, currency: 'EGP' } },
      refunds: [
        { paymentId: charge!.id, method: 'card', amount: { amount: 8000, currency: 'EGP' } },
      ],
      changedFields: ['seats'],
      unavailableSeats: [],
    });
    expect(
      (
        preview.body.proposed.seats as { label: string; price: { amount: number }; kept: boolean }[]
      ).map((seat) => [seat.label, seat.price.amount, seat.kept]),
    ).toEqual([
      ['A2', 15000, false],
      ['A3', 15000, false],
    ]);
    // The preview wrote nothing.
    expect(await bookingRow(paid.reference)).toEqual(before);
    expect(await readPayments(testApp.knex, paid.bookingId)).toHaveLength(1);

    const edit = await editBooking(testApp, admin.authorization, paid.reference, body);
    expect(edit.status).toBe(201);
    expect(edit.body.difference).toEqual(preview.body.difference);
    expect(edit.body.changedFields).toEqual(preview.body.changedFields);
    expect(edit.body.booking.total).toEqual(preview.body.proposed.total);
    expect(
      (edit.body.booking.seats as { label: string; price: unknown }[]).map((seat) => [
        seat.label,
        seat.price,
      ]),
    ).toEqual(
      (preview.body.proposed.seats as { label: string; price: unknown }[]).map((seat) => [
        seat.label,
        seat.price,
      ]),
    );
    expect(
      (edit.body.payments as { refundOfPaymentId: number; amount: unknown }[]).map((payment) => [
        payment.refundOfPaymentId,
        payment.amount,
      ]),
    ).toEqual(
      (preview.body.refunds as { paymentId: number; amount: unknown }[]).map((refund) => [
        refund.paymentId,
        refund.amount,
      ]),
    );

    const payments = await readPayments(testApp.knex, paid.bookingId);
    expect(
      payments.map((row) => [
        row.kind,
        row.purpose,
        row.status,
        row.amount,
        row.provider_idempotency_key,
      ]),
    ).toEqual([
      ['charge', 'sale', 'succeeded', 38000, `${paid.reference}-c1`],
      ['refund', 'edit_difference', 'succeeded', 8000, `${paid.reference}-r1`],
    ]);
    expect(await bookingRow(paid.reference)).toMatchObject({
      seat_count: 2,
      total_amount: 30000,
      qr_version: 2,
    });
    expect(await claimsOf(paid.bookingId)).toEqual([
      { showtime_id: showtime.showtimeId, seat_label: 'A2', claimed_until: null },
      { showtime_id: showtime.showtimeId, seat_label: 'A3', claimed_until: null },
    ]);
    expect(await seatsOf(paid.bookingId)).toEqual([
      { seat_label: 'A2', price: 15000 },
      { seat_label: 'A3', price: 15000 },
    ]);
    // The old seats are free again; the new QR code replaced the old one.
    expect((await holdSeats(testApp, showtime.showtimeId, ['B2', 'B3'])).status).toBe(201);
    expect(edit.body.booking.ticket.qrCode).toMatch(/^MQ1\.MQ-[A-Z0-9]{6}\.2\./);

    // The detail shows what is left to refund: the charge minus its partial refund.
    const detail = await testApp
      .http()
      .get(`/api/v1/admin/bookings/${paid.reference}`)
      .set('Authorization', admin.authorization);
    expect(detail.body.refundable).toEqual({ amount: 30000, currency: 'EGP' });
    expect(detail.body.payments[0].refundable).toEqual({ amount: 30000, currency: 'EGP' });

    const audit = await testApp
      .knex('audit_events')
      .first('changed_fields', 'metadata')
      .where({ booking_id: paid.bookingId, action: 'booking.edited' });
    expect(audit).toEqual({
      changed_fields: ['seats'],
      metadata: {
        reason: 'customer_request',
        fromShowtimeId: showtime.showtimeId,
        toShowtimeId: showtime.showtimeId,
        seatCount: 2,
        difference: -8000,
        notify: false,
      },
    });
    const history = await testApp
      .http()
      .get(`/api/v1/bookings/${paid.reference}/history`)
      .set('Authorization', paid.authorization);
    expect((history.body.items as { kind: string }[]).map((event) => event.kind)).toContain(
      'changed_by_cinema',
    );
    // A later cancel refunds what is left: 300, not the original 380.
    const refund = await refundBooking(testApp, admin.authorization, paid.reference);
    const refunds = refund.body.refunds as { amount: { amount: number } }[];
    expect(refunds.map((r) => r.amount.amount)).toEqual([30000]);
  });

  it('takes a higher total at the counter in the same request', async () => {
    const paid = await paidOnline(testApp, showtime.showtimeId, ['A4']);
    const body = { seats: ['D2'], reason: 'seat_problem' };
    const preview = await previewEdit(testApp, admin.authorization, paid.reference, body);
    expect(preview.body.difference).toEqual({
      direction: 'collect',
      amount: { amount: 8000, currency: 'EGP' },
    });
    expect(preview.body.refunds).toEqual([]);

    const missing = await editBooking(testApp, admin.authorization, paid.reference, body);
    expectError(missing, 400, 'VALIDATION_FAILED');
    expect(missing.body.error.details.fields[0].field).toBe('payment');
    expectError(
      await editBooking(testApp, admin.authorization, paid.reference, {
        ...body,
        payment: { method: 'card_terminal' },
      }),
      400,
      'VALIDATION_FAILED',
    );
    const edit = await editBooking(testApp, admin.authorization, paid.reference, {
      ...body,
      payment: { method: 'card_terminal', receiptReference: 'TRX-9' },
    });
    expect(edit.status).toBe(201);
    expect(edit.body.payments).toEqual([
      expect.objectContaining({
        kind: 'charge',
        purpose: 'edit_difference',
        method: 'card_terminal',
        status: 'succeeded',
        amount: { amount: 8000, currency: 'EGP' },
        receiptReference: 'TRX-9',
      }),
    ]);
    expect(edit.body.booking.total).toEqual({ amount: 23000, currency: 'EGP' });
    const counter = (await testApp
      .knex('payments')
      .first('collected_by_staff_id')
      .where({ booking_id: paid.bookingId, purpose: 'edit_difference' })) as {
      collected_by_staff_id: number;
    };
    expect(counter.collected_by_staff_id).toBe(admin.staffUserId);

    // A payment for a total that does not go up is refused.
    expectError(
      await editBooking(testApp, admin.authorization, paid.reference, {
        seats: ['A4'],
        reason: 'staff_error',
        payment: { method: 'cash' },
      }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('keeps the sold price of a kept seat and prices a new seat at the current price', async () => {
    const paid = await paidOnline(testApp, showtime.showtimeId, ['B4']);
    const prices = await testApp
      .http()
      .patch(`/api/v1/admin/showtimes/${showtime.showtimeId}`)
      .set('Authorization', admin.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({
        prices: {
          front: { amount: 15000, currency: 'EGP' },
          middle: { amount: 20000, currency: 'EGP' },
          back: { amount: 23000, currency: 'EGP' },
        },
      });
    expect(prices.status).toBe(200);
    const preview = await previewEdit(testApp, admin.authorization, paid.reference, {
      seats: ['B4', 'B5'],
      reason: 'customer_request',
    });
    expect(
      (
        preview.body.proposed.seats as { label: string; price: { amount: number }; kept: boolean }[]
      ).map((seat) => [seat.label, seat.price.amount, seat.kept]),
    ).toEqual([
      ['B4', 19000, true],
      ['B5', 20000, false],
    ]);
    expect(preview.body.difference).toEqual({
      direction: 'collect',
      amount: { amount: 20000, currency: 'EGP' },
    });
    // Back to the theater's prices for the other tests.
    await testApp
      .http()
      .patch(`/api/v1/admin/showtimes/${showtime.showtimeId}`)
      .set('Authorization', admin.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({
        prices: {
          front: { amount: 15000, currency: 'EGP' },
          middle: { amount: 19000, currency: 'EGP' },
          back: { amount: 23000, currency: 'EGP' },
        },
      });
  });

  it('moves a booking to another showtime of the same movie and sends new tickets', async () => {
    const paid = await paidOnline(testApp, showtime.showtimeId, ['C2'], { phone: '01012345678' });
    const before = (await readMessages(testApp.knex)).length;
    const edit = await editBooking(testApp, admin.authorization, paid.reference, {
      showtimeId: later.showtimeId,
      reason: 'showtime_changed',
      notify: true,
    });
    expect(edit.status).toBe(201);
    expect(edit.body).toMatchObject({
      difference: { direction: 'none', amount: { amount: 0, currency: 'EGP' } },
      changedFields: ['showtime'],
      payments: [],
      booking: { showtime: { id: later.showtimeId }, seatCount: 1 },
    });
    expect(await claimsOf(paid.bookingId)).toEqual([
      { showtime_id: later.showtimeId, seat_label: 'C2', claimed_until: null },
    ]);
    expect((await holdSeats(testApp, showtime.showtimeId, ['C2'])).status).toBe(201);
    const queued = (await readMessages(testApp.knex)).slice(before);
    expect(queued.map((message) => message.template)).toEqual([
      'booking.tickets',
      'booking.tickets_sms',
    ]);
  });

  it('refuses another movie, an unknown showtime and seats outside the hall', async () => {
    const paid = await paidOnline(testApp, showtime.showtimeId, ['C3']);
    for (const body of [
      { showtimeId: otherMovie.showtimeId, reason: 'showtime_changed' },
      { showtimeId: 999999, reason: 'showtime_changed' },
      { seats: ['D8'], reason: 'seat_problem' },
      { seats: ['P20'], reason: 'seat_problem' },
      { reason: 'customer_request' },
      { seats: ['C3'], reason: 'customer_request' },
      { seats: ['C4'] },
      { seats: ['C4'], reason: 'because' },
      { seats: [], reason: 'seat_problem' },
    ]) {
      expectError(
        await editBooking(testApp, admin.authorization, paid.reference, body),
        400,
        'VALIDATION_FAILED',
      );
    }
    expect((await bookingRow(paid.reference))?.qr_version).toBe(1);
    expectError(
      await editBooking(testApp, admin.authorization, 'MQ-ZZZZZZ', {
        seats: ['C4'],
        reason: 'seat_problem',
      }),
      404,
      'NOT_FOUND',
    );
  });

  it('changes nothing when a target seat is taken', async () => {
    const paid = await paidOnline(testApp, showtime.showtimeId, ['C5']);
    await expectHold(testApp, showtime.showtimeId, ['C6']);
    const body = { seats: ['C5', 'C6'], reason: 'customer_request', payment: { method: 'cash' } };
    const preview = await previewEdit(testApp, admin.authorization, paid.reference, body);
    expect(preview.body.unavailableSeats).toEqual(['C6']);
    const edit = await editBooking(testApp, admin.authorization, paid.reference, body);
    expectError(edit, 409, 'SEAT_TAKEN');
    expect(edit.body.error.details).toEqual({ seats: ['C6'] });
    expect(await bookingRow(paid.reference)).toMatchObject({
      seat_count: 1,
      total_amount: 19000,
      qr_version: 1,
    });
    expect(await claimsOf(paid.bookingId)).toEqual([
      { showtime_id: showtime.showtimeId, seat_label: 'C5', claimed_until: null },
    ]);
    expect(await seatsOf(paid.bookingId)).toEqual([{ seat_label: 'C5', price: 19000 }]);
    expect(await readPayments(testApp.knex, paid.bookingId)).toHaveLength(1);
  });

  it('edits the contact alone and refuses an edit that changes nothing', async () => {
    const paid = await paidOnline(testApp, showtime.showtimeId, ['C7']);
    const edit = await editBooking(testApp, admin.authorization, paid.reference, {
      contact: { name: '  Laila Hassan ', phone: '01098765432' },
      reason: 'customer_request',
    });
    expect(edit.status).toBe(201);
    expect(edit.body.changedFields).toEqual(['contactName', 'contactPhone']);
    expect(await bookingRow(paid.reference)).toMatchObject({
      contact_name: 'Laila Hassan',
      contact_phone: '+201098765432',
      qr_version: 2,
    });
    const audit = await testApp
      .knex('audit_events')
      .first('changed_fields', 'metadata')
      .where({ booking_id: paid.bookingId, action: 'booking.edited' });
    expect(JSON.stringify(audit)).not.toContain('Laila');
    expect(JSON.stringify(audit)).not.toContain('98765432');
    expectError(
      await editBooking(testApp, admin.authorization, paid.reference, {
        contact: { name: 'Laila Hassan' },
        reason: 'customer_request',
      }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('refuses a booking that is held, checked in, started, completed or refunded', async () => {
    const body = { seats: ['A8'], reason: 'staff_error' };
    const hold = await expectHold(testApp, showtime.showtimeId, ['A7']);
    const held = await editBooking(testApp, admin.authorization, hold.reference, body);
    expectError(held, 409, 'BOOKING_NOT_EDITABLE');
    expect(held.body.error.details).toEqual({ reason: 'not_confirmed', status: 'held' });

    const refunded = await paidOnline(testApp, showtime.showtimeId, ['A6']);
    await refundBooking(testApp, admin.authorization, refunded.reference);
    expect(
      (await editBooking(testApp, admin.authorization, refunded.reference, body)).body.error
        .details,
    ).toEqual({ reason: 'not_confirmed', status: 'refunded' });

    const scanned = await paidOnline(testApp, showtime.showtimeId, ['A5']);
    const started = await paidOnline(testApp, showtime.showtimeId, ['A4']);
    // 18:45 on the show day: scanning is open; check one booking in.
    clock.set(new Date(showtime.startsAt.getTime() - 45 * 60 * 1000));
    const staff = await signInStaff(testApp, admin.email, admin.password);
    const scan = await scanTicket(testApp, staff.authorization, {
      theaterId: showtime.theaterId,
      reference: scanned.reference,
      confirm: true,
    });
    expect(scan.body.result).toBe('VALID');
    expect(
      (await editBooking(testApp, staff.authorization, scanned.reference, body)).body.error.details,
    ).toEqual({ reason: 'checked_in', status: 'confirmed' });

    clock.set(new Date(showtime.startsAt.getTime() + 5 * 60 * 1000));
    const during = await signInStaff(testApp, admin.email, admin.password);
    expect(
      (await editBooking(testApp, during.authorization, started.reference, body)).body.error
        .details,
    ).toEqual({ reason: 'started', status: 'confirmed' });

    clock.set(new Date(showtime.startsAt.getTime() + 4 * 60 * 60 * 1000));
    const after = await signInStaff(testApp, admin.email, admin.password);
    expect(
      (await editBooking(testApp, after.authorization, started.reference, body)).body.error.details,
    ).toEqual({ reason: 'not_confirmed', status: 'completed' });
    const preview = await previewEdit(testApp, after.authorization, started.reference, body);
    expectError(preview, 409, 'BOOKING_NOT_EDITABLE');
  });
});
