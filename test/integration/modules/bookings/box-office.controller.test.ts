import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { QrCodeService } from '../../../../src/modules/bookings/qr-code.service';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import { CASH_WALK_IN, counterHold, counterPay, counterSale } from '../../../support/box-office';
import { customerHold, pay, pdfTextRuns, readPayments } from '../../../support/checkout';
import { TestClock } from '../../../support/clock';
import { blockCustomer, registerCustomer } from '../../../support/customer-auth';
import { bookableShowtime, expectHold, seatMapClient } from '../../../support/holds';
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
 * The box office (design §7.6, §7.9; PRD A6 "New booking", Payments 2): counter holds under the
 * online holds' rules and lock order, counter sales paid on the spot and confirmed with their
 * tickets, and the staff ticket download. Real app and Postgres; only Resend is replaced.
 */
describe('Box office (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let boxOffice: StaffSession;
  let colleague: StaffSession;
  let showtime: BookableShowtimeFixture;
  let other: BookableShowtimeFixture;
  const clock = new TestClock(NOW);
  const sender = new RecordingEmailSender();

  const bookingRow = (reference: string) =>
    testApp
      .knex('bookings')
      .select(
        'id',
        'status',
        'channel',
        'customer_id',
        'created_by_staff_id',
        'contact_name',
        'contact_email',
        'contact_phone',
        'hold_token_hash',
        'hold_expires_at',
        'qr_version',
      )
      .where({ reference })
      .first();
  const claimsOf = (bookingId: number) =>
    testApp
      .knex('seat_claims')
      .select<{ seat_label: string; claimed_until: Date | null }[]>('seat_label', 'claimed_until')
      .where({ booking_id: bookingId })
      .orderBy('seat_label');
  const auditOf = (bookingId: number) =>
    testApp
      .knex('audit_events')
      .select<
        {
          action: string;
          actor_kind: string;
          actor_staff_user_id: number | null;
          metadata: object;
        }[]
      >('action', 'actor_kind', 'actor_staff_user_id', 'metadata')
      .where({ booking_id: bookingId })
      .orderBy('id');
  const download = (reference: string, authorization: string) =>
    testApp
      .http()
      .get(`/api/v1/admin/bookings/${reference}/ticket.pdf`)
      .set('Authorization', authorization)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });

  beforeAll(async () => {
    testApp = await createTestApp({
      clock,
      overrides: [{ provide: EmailSender, useValue: sender }],
    });
    admin = await staffSession(testApp, 'admin');
    boxOffice = await staffSession(testApp, 'box_office');
    colleague = await staffSession(testApp, 'box_office');
    showtime = await bookableShowtime(testApp, admin);
    other = await bookableShowtime(testApp, admin, { fixture: showtime, startTime: '22:00' });
  });

  beforeEach(async () => {
    clock.set(NOW);
    await testApp.knex.raw(
      'TRUNCATE payments, seat_claims, booking_seats, bookings, hold_refusals, audit_events, idempotency_keys, messages CASCADE',
    );
    sender.reset();
  });

  afterAll(async () => {
    await testApp.close();
  });

  describe('POST /admin/counter-holds', () => {
    it("holds the seats as the member's counter hold, priced like an online hold", async () => {
      const response = await counterHold(testApp, boxOffice.authorization, showtime.showtimeId, [
        'C3',
        'A2',
      ]);

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        status: 'held',
        channel: 'counter',
        owner: 'staff',
        seatCount: 2,
        total: { amount: 15000 + 19000, currency: 'EGP' },
        paymentStatus: 'unpaid',
        payment: null,
        ticket: null,
        holdExpiresAt: '2026-10-10T10:05:00+03:00',
      });
      const seats = response.body.seats as { label: string }[];
      expect(seats.map((seat) => seat.label)).toEqual(['A2', 'C3']);
      expect(response.body).not.toHaveProperty('holdCode');
      const row = await bookingRow(response.body.reference as string);
      expect(row).toMatchObject({
        status: 'held',
        channel: 'counter',
        customer_id: null,
        created_by_staff_id: boxOffice.staffUserId,
        hold_token_hash: null,
        contact_name: null,
      });
      expect((await claimsOf(row.id)).map((claim) => claim.claimed_until)).toEqual([
        new Date('2026-10-10T10:05:00+03:00'),
        new Date('2026-10-10T10:05:00+03:00'),
      ]);
      expect(await auditOf(row.id)).toEqual([
        {
          action: 'booking.held',
          actor_kind: 'staff',
          actor_staff_user_id: boxOffice.staffUserId,
          metadata: {
            showtimeId: showtime.showtimeId,
            seatCount: 2,
            channel: 'counter',
            holder: 'staff',
          },
        },
      ]);
    });

    it('takes the seats off the online map at once', async () => {
      const map = await seatMapClient(testApp);
      map.send('subscribe', { showtimeId: showtime.showtimeId });
      expect((await map.next()).event).toBe('snapshot');

      expect(
        (await counterHold(testApp, admin.authorization, showtime.showtimeId, ['B4'])).status,
      ).toBe(201);
      const held = await map.next();
      expect(held).toMatchObject({ event: 'seat.held', data: { labels: ['B4'] } });
      await map.close();

      const guest = await testApp
        .http()
        .post(`/api/v1/showtimes/${showtime.showtimeId}/holds`)
        .set('Idempotency-Key', randomUUID())
        .send({ seats: ['B4'] });
      expectError(guest, 409, 'SEAT_TAKEN');
      expect(guest.body.error.details).toEqual({ seats: ['B4'] });
    });

    it("releases the member's previous counter hold, and nobody else's", async () => {
      const first = await counterHold(testApp, boxOffice.authorization, other.showtimeId, ['B1']);
      const colleagues = await counterHold(testApp, colleague.authorization, showtime.showtimeId, [
        'B2',
      ]);
      const guest = await expectHold(testApp, showtime.showtimeId, ['B3']);
      const second = await counterHold(testApp, boxOffice.authorization, showtime.showtimeId, [
        'B1',
      ]);
      expect(second.status).toBe(201);

      const firstRow = await bookingRow(first.body.reference as string);
      expect(firstRow.hold_expires_at).toEqual(NOW);
      const view = await testApp
        .http()
        .get(`/api/v1/admin/bookings/${first.body.reference as string}/ticket.pdf`)
        .set('Authorization', boxOffice.authorization);
      expectError(view, 409, 'TICKET_NOT_AVAILABLE');
      expect(view.body.error.details).toEqual({ status: 'abandoned' });
      for (const reference of [colleagues.body.reference, guest.reference] as string[]) {
        expect((await bookingRow(reference)).hold_expires_at).toEqual(
          new Date('2026-10-10T10:05:00+03:00'),
        );
      }
      expect((await auditOf(firstRow.id)).map((event) => event.action)).toEqual([
        'booking.held',
        'booking.released',
      ]);
    });

    it('refuses a seat a customer holds, and a showtime that is not bookable', async () => {
      await customerHold(testApp, showtime.showtimeId, ['C1']);
      const taken = await counterHold(testApp, boxOffice.authorization, showtime.showtimeId, [
        'C1',
        'C2',
      ]);
      expectError(taken, 409, 'SEAT_TAKEN');
      expect(taken.body.error.details).toEqual({ seats: ['C1'] });

      clock.set(new Date('2026-10-11T19:30:00+03:00'));
      const later = await signInStaff(testApp, boxOffice.email, boxOffice.password);
      const started = await counterHold(testApp, later.authorization, showtime.showtimeId, ['C2']);
      expectError(started, 409, 'SHOWTIME_NOT_BOOKABLE');
      expect(started.body.error.details).toEqual({ reason: 'started' });

      expectError(
        await counterHold(testApp, later.authorization, 999_999, ['C2']),
        404,
        'NOT_FOUND',
      );
      const outside = await counterHold(testApp, later.authorization, other.showtimeId, ['D8']);
      expectError(outside, 400, 'VALIDATION_FAILED');
    });

    it('validates the body and requires an Idempotency-Key', async () => {
      const nine = ['A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'B1', 'B2'];
      expectError(
        await counterHold(testApp, boxOffice.authorization, showtime.showtimeId, nine),
        400,
        'VALIDATION_FAILED',
      );
      const noShowtime = await testApp
        .http()
        .post('/api/v1/admin/counter-holds')
        .set('Authorization', boxOffice.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ seats: ['A2'] });
      expectError(noShowtime, 400, 'VALIDATION_FAILED');
      const noKey = await testApp
        .http()
        .post('/api/v1/admin/counter-holds')
        .set('Authorization', boxOffice.authorization)
        .send({ showtimeId: showtime.showtimeId, seats: ['A2'] });
      expectError(noKey, 400, 'IDEMPOTENCY_KEY_REQUIRED');
    });
  });

  describe('POST /admin/bookings/{ref}/counter-payments', () => {
    it('settles a cash sale for a walk-in: confirmed, sold, ticketed, audited, no message', async () => {
      const hold = await counterHold(testApp, boxOffice.authorization, showtime.showtimeId, [
        'B2',
        'B3',
      ]);
      const reference = hold.body.reference as string;
      const sale = await counterPay(testApp, boxOffice.authorization, reference, CASH_WALK_IN);

      expect(sale.status).toBe(201);
      expect(sale.body.payment).toMatchObject({
        status: 'succeeded',
        method: 'cash',
        amount: { amount: 38000, currency: 'EGP' },
        receiptReference: null,
        card: null,
        completedAt: '2026-10-10T10:00:00+03:00',
        settlesAt: null,
      });
      expect(sale.body.booking).toMatchObject({
        reference,
        status: 'confirmed',
        channel: 'counter',
        owner: 'staff',
        paymentStatus: 'paid',
        ticket: { admits: 2 },
      });
      const qr = testApp.app.get(QrCodeService).verify(sale.body.booking.ticket.qrCode as string);
      expect(qr).toEqual({ reference, version: 1 });

      const row = await bookingRow(reference);
      expect(row).toMatchObject({ status: 'confirmed', qr_version: 1, customer_id: null });
      expect((await claimsOf(row.id)).map((claim) => claim.claimed_until)).toEqual([null, null]);
      const [payment] = await readPayments(testApp.knex, row.id);
      expect(payment).toMatchObject({
        kind: 'charge',
        purpose: 'sale',
        method: 'cash',
        status: 'succeeded',
        amount: 38000,
        provider_idempotency_key: null,
        provider_reference: null,
      });
      const collected = await testApp
        .knex('payments')
        .select('collected_by_staff_id')
        .where({ booking_id: row.id })
        .first();
      expect(collected).toEqual({ collected_by_staff_id: boxOffice.staffUserId });
      expect((await readMessages(testApp.knex)).length).toBe(0);
      expect(await auditOf(row.id)).toEqual([
        expect.objectContaining({ action: 'booking.held' }),
        {
          action: 'booking.confirmed',
          actor_kind: 'staff',
          actor_staff_user_id: boxOffice.staffUserId,
          metadata: { showtimeId: showtime.showtimeId, seatCount: 2, channel: 'counter' },
        },
        {
          action: 'payment.succeeded',
          actor_kind: 'staff',
          actor_staff_user_id: boxOffice.staffUserId,
          metadata: {
            method: 'cash',
            purpose: 'sale',
            channel: 'counter',
            customerKind: 'walk_in',
          },
        },
      ]);
    });

    it('records the card terminal receipt reference and sends the tickets to typed contact details', async () => {
      const sale = await counterSale(
        testApp,
        boxOffice.authorization,
        showtime.showtimeId,
        ['C5'],
        {
          method: 'card_terminal',
          receiptReference: '  TRX-0042817 ',
          customer: {
            kind: 'contact',
            fullName: ' Karim Mostafa ',
            email: 'Karim.Mostafa@Example.com',
            phone: '01012345678',
          },
        },
      );
      expect(sale.body.payment).toMatchObject({
        method: 'card_terminal',
        receiptReference: 'TRX-0042817',
      });
      const row = await bookingRow(sale.body.booking.reference as string);
      expect(row).toMatchObject({
        customer_id: null,
        contact_name: 'Karim Mostafa',
        contact_email: 'karim.mostafa@example.com',
        contact_phone: '+201012345678',
      });
      expect((await readPayments(testApp.knex, row.id))[0]!.provider_reference).toBe('TRX-0042817');
      const messages = (await readMessages(testApp.knex)).filter(
        (message) => message.related_booking_id === row.id,
      );
      expect(messages.map((message) => [message.template, message.recipient])).toEqual([
        ['booking.tickets', 'karim.mostafa@example.com'],
        ['booking.tickets_sms', '+201012345678'],
      ]);
    });

    it("sells to an existing customer: the booking becomes theirs and shows the customer's details", async () => {
      const customer = await registerCustomer(testApp, { fullName: 'Layla Hassan' });
      const sale = await counterSale(testApp, admin.authorization, showtime.showtimeId, ['D1'], {
        method: 'cash',
        customer: { kind: 'existing', customerId: customer.customerId },
      });
      expect(sale.body.booking.owner).toBe('customer');
      const reference = sale.body.booking.reference as string;
      expect(await bookingRow(reference)).toMatchObject({
        customer_id: customer.customerId,
        created_by_staff_id: admin.staffUserId,
        contact_name: 'Layla Hassan',
        contact_email: customer.email,
      });
      const own = await testApp
        .http()
        .get(`/api/v1/bookings/${reference}`)
        .set('Authorization', customer.authorization);
      expect(own.status).toBe(200);
      expect(own.body).toMatchObject({ status: 'confirmed', channel: 'counter' });
      const messages = (await readMessages(testApp.knex)).filter(
        (message) => message.template === 'booking.tickets',
      );
      expect(messages.map((message) => message.recipient)).toEqual([customer.email]);
    });

    it('refuses an unknown or blocked customer account, and writes nothing', async () => {
      const blocked = await registerCustomer(testApp);
      await blockCustomer(testApp, blocked.customerId);
      const hold = await counterHold(testApp, boxOffice.authorization, showtime.showtimeId, ['D2']);
      const reference = hold.body.reference as string;
      for (const customerId of [blocked.customerId, 999_999]) {
        const refused = await counterPay(testApp, boxOffice.authorization, reference, {
          method: 'cash',
          customer: { kind: 'existing', customerId },
        });
        expectError(refused, 400, 'VALIDATION_FAILED');
        expect(refused.body.error.details.fields[0].field).toBe('customer.customerId');
      }
      const row = await bookingRow(reference);
      expect(row.status).toBe('held');
      expect(await readPayments(testApp.knex, row.id)).toEqual([]);
    });

    it('refuses mixed-up bodies: a receipt with cash, none with the terminal, stray customer fields', async () => {
      const hold = await counterHold(testApp, boxOffice.authorization, showtime.showtimeId, ['D3']);
      const reference = hold.body.reference as string;
      const bodies: [Record<string, unknown>, string][] = [
        [
          { method: 'cash', receiptReference: 'R1', customer: { kind: 'walk_in' } },
          'receiptReference',
        ],
        [{ method: 'card_terminal', customer: { kind: 'walk_in' } }, 'receiptReference'],
        [
          { method: 'card_terminal', receiptReference: '#bad', customer: { kind: 'walk_in' } },
          'receiptReference',
        ],
        [{ method: 'card', customer: { kind: 'walk_in' } }, 'method'],
        [{ method: 'cash', customer: { kind: 'walk_in', fullName: 'X' } }, 'customer.fullName'],
        [{ method: 'cash', customer: { kind: 'contact' } }, 'customer.fullName'],
        [{ method: 'cash', customer: { kind: 'existing' } }, 'customer.customerId'],
        [{ method: 'cash' }, 'customer'],
        [{ method: 'cash', amount: 1, customer: { kind: 'walk_in' } }, 'amount'],
      ];
      for (const [body, field] of bodies) {
        const response = await counterPay(testApp, boxOffice.authorization, reference, body);
        expectError(response, 400, 'VALIDATION_FAILED');
        expect({
          body,
          fields: (response.body.error.details.fields as { field: string }[]).map(
            (entry) => entry.field,
          ),
        }).toEqual({ body, fields: [field] });
      }
      expect((await bookingRow(reference)).status).toBe('held');
    });

    it("refuses another member's hold, an online booking and an unknown reference", async () => {
      const hold = await counterHold(testApp, boxOffice.authorization, showtime.showtimeId, ['A3']);
      const reference = hold.body.reference as string;
      const theirs = await counterPay(testApp, colleague.authorization, reference);
      expectError(theirs, 403, 'FORBIDDEN');
      expect(theirs.body.error.details).toEqual({ reason: 'not_your_counter_hold' });
      expectError(await counterPay(testApp, admin.authorization, reference), 403, 'FORBIDDEN');

      const online = await customerHold(testApp, showtime.showtimeId, ['A4']);
      expectError(
        await counterPay(testApp, boxOffice.authorization, online.reference),
        404,
        'NOT_FOUND',
      );
      expectError(
        await counterPay(testApp, boxOffice.authorization, 'MQ-222222'),
        404,
        'NOT_FOUND',
      );
      expect((await bookingRow(reference)).status).toBe('held');
    });

    it('answers HOLD_EXPIRED at the end of the hold, and ALREADY_PAID once paid', async () => {
      const hold = await counterHold(testApp, boxOffice.authorization, showtime.showtimeId, ['A5']);
      const reference = hold.body.reference as string;
      clock.set(new Date('2026-10-10T10:05:00+03:00'));
      expectError(
        await counterPay(testApp, boxOffice.authorization, reference),
        409,
        'HOLD_EXPIRED',
      );

      clock.set(NOW);
      const again = await counterHold(testApp, boxOffice.authorization, showtime.showtimeId, [
        'A6',
      ]);
      const ref2 = again.body.reference as string;
      const key = randomUUID();
      const first = await counterPay(testApp, boxOffice.authorization, ref2, CASH_WALK_IN, key);
      expect(first.status).toBe(201);
      const replay = await counterPay(testApp, boxOffice.authorization, ref2, CASH_WALK_IN, key);
      expect(replay.status).toBe(201);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expectError(await counterPay(testApp, boxOffice.authorization, ref2), 409, 'ALREADY_PAID');
      const row = await bookingRow(ref2);
      expect(await readPayments(testApp.knex, row.id)).toHaveLength(1);
    });

    it('refuses a sale once the showtime started, before judging the hold', async () => {
      const hold = await counterHold(testApp, boxOffice.authorization, other.showtimeId, ['A7']);
      clock.set(new Date('2026-10-11T22:00:00+03:00'));
      const later = await signInStaff(testApp, boxOffice.email, boxOffice.password);
      const started = await counterPay(testApp, later.authorization, hold.body.reference);
      expectError(started, 409, 'SHOWTIME_NOT_BOOKABLE');
      expect(started.body.error.details).toEqual({ reason: 'started' });
    });
  });

  describe('DELETE /admin/counter-holds/{ref}', () => {
    it("frees the member's own hold, refuses another member's and a paid booking", async () => {
      const hold = await counterHold(testApp, boxOffice.authorization, showtime.showtimeId, ['A8']);
      const reference = hold.body.reference as string;
      const release = (authorization: string, ref: string = reference) =>
        testApp
          .http()
          .delete(`/api/v1/admin/counter-holds/${ref}`)
          .set('Authorization', authorization);

      expectError(await release(colleague.authorization), 403, 'FORBIDDEN');
      expect((await release(boxOffice.authorization)).status).toBe(204);
      const row = await bookingRow(reference);
      expect(row.hold_expires_at).toEqual(NOW);
      expect((await release(boxOffice.authorization)).status).toBe(204);
      expect(await expectHold(testApp, showtime.showtimeId, ['A8'])).toBeTruthy();
      expect((await auditOf(row.id)).map((event) => [event.action, event.actor_kind])).toEqual([
        ['booking.held', 'staff'],
        ['booking.released', 'staff'],
      ]);

      const sold = await counterSale(testApp, boxOffice.authorization, showtime.showtimeId, ['B8']);
      expectError(
        await release(boxOffice.authorization, sold.body.booking.reference as string),
        409,
        'ALREADY_PAID',
      );
      const online = await customerHold(testApp, showtime.showtimeId, ['B7']);
      expectError(await release(boxOffice.authorization, online.reference), 404, 'NOT_FOUND');
    });
  });

  describe('GET /admin/bookings/{ref}/ticket.pdf', () => {
    it("downloads any booking's PDF ticket for staff, and records the download", async () => {
      const sale = await counterSale(testApp, boxOffice.authorization, showtime.showtimeId, ['C6']);
      const online = await customerHold(testApp, showtime.showtimeId, ['C7']);
      expect((await pay(testApp, online.customer.authorization, online.reference)).status).toBe(
        201,
      );

      for (const [reference, staff] of [
        [sale.body.booking.reference as string, boxOffice],
        [online.reference, admin],
      ] as const) {
        const response = await download(reference, staff.authorization);
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('application/pdf');
        expect(response.headers['content-disposition']).toBe(
          `attachment; filename="maqady-ticket-${reference}.pdf"`,
        );
        expect(response.headers['cache-control']).toBe('private, no-store');
        const pdf = response.body as Buffer;
        expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
        expect(pdfTextRuns(pdf).join('\n')).toContain(reference);
        const row = await bookingRow(reference);
        const events = await auditOf(row.id);
        expect(events[events.length - 1]).toEqual({
          action: 'booking.ticket_downloaded',
          actor_kind: 'staff',
          actor_staff_user_id: staff.staffUserId,
          metadata: { format: 'pdf' },
        });
      }
    });

    it('answers TICKET_NOT_AVAILABLE without a ticket, NOT_FOUND for an unknown reference', async () => {
      const hold = await counterHold(testApp, boxOffice.authorization, showtime.showtimeId, ['C8']);
      const held = await download(hold.body.reference as string, boxOffice.authorization);
      expect(held.status).toBe(409);
      expect(JSON.parse((held.body as Buffer).toString('utf8')).error).toMatchObject({
        code: 'TICKET_NOT_AVAILABLE',
        details: { status: 'held' },
      });
      expect((await download('MQ-222222', boxOffice.authorization)).status).toBe(404);
    });
  });

  describe('access', () => {
    it('refuses customer tokens and anonymous callers on every box office route', async () => {
      const online = await customerHold(testApp, showtime.showtimeId, ['D4']);
      const token = online.customer.authorization;
      const calls = [
        testApp
          .http()
          .post('/api/v1/admin/counter-holds')
          .set('Idempotency-Key', randomUUID())
          .send({ showtimeId: showtime.showtimeId, seats: ['D5'] }),
        testApp.http().delete(`/api/v1/admin/counter-holds/${online.reference}`),
        testApp
          .http()
          .post(`/api/v1/admin/bookings/${online.reference}/counter-payments`)
          .set('Idempotency-Key', randomUUID())
          .send(CASH_WALK_IN),
        testApp.http().get(`/api/v1/admin/bookings/${online.reference}/ticket.pdf`),
        testApp.http().post('/api/v1/admin/scans').send({ theaterId: 1, code: 'x' }),
      ];
      for (const call of calls)
        expectError(await call.set('Authorization', token), 401, 'UNAUTHENTICATED');
      expectError(
        await testApp.http().post('/api/v1/admin/scans').send({ theaterId: 1, code: 'x' }),
        401,
        'UNAUTHENTICATED',
      );
      expect((await bookingRow(online.reference)).status).toBe('held');
      expect(await testApp.knex('bookings').count<{ n: number }[]>({ n: '*' })).toEqual([{ n: 1 }]);
    });
  });
});
