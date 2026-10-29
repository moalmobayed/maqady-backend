import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import {
  listAdminBookings,
  paidOnline,
  payOutRefund,
  refundBooking,
} from '../../../support/admin-bookings';
import { CASH_WALK_IN, counterSale } from '../../../support/box-office';
import { customerHold, pay } from '../../../support/checkout';
import { TestClock } from '../../../support/clock';
import { registerCustomer } from '../../../support/customer-auth';
import { bookableShowtime, expectHold } from '../../../support/holds';
import { readMessages } from '../../../support/messaging/messages';
import { RecordingEmailSender } from '../../../support/messaging/recording-email-sender';
import { signInStaff, staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { BookableShowtimeFixture, StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(180_000);

/** Saturday 10 October 2026, 10:00 Cairo time: cinema day 2026-10-10; the shows are on the 11th. */
const NOW = new Date('2026-10-10T10:00:00+03:00');

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

const references = (response: Response): string[] =>
  (response.body.items as { reference: string }[]).map((item) => item.reference);

/**
 * The admin Bookings page (design §11; PRD A6): the list with its search and filters, the summary
 * cards, the detail, internal notes and the staff resend, with the role rules. Real app and
 * Postgres; only Resend is replaced.
 */
describe('Admin bookings (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let boxOffice: StaffSession;
  let showtimeA: BookableShowtimeFixture;
  let showtimeB: BookableShowtimeFixture;
  const clock = new TestClock(NOW);
  const sender = new RecordingEmailSender();

  beforeAll(async () => {
    testApp = await createTestApp({
      clock,
      overrides: [{ provide: EmailSender, useValue: sender }],
    });
    admin = await staffSession(testApp, 'admin', { fullName: 'Mona Saeed' });
    boxOffice = await staffSession(testApp, 'box_office', { fullName: 'Hany Adel' });
    showtimeA = await bookableShowtime(testApp, admin);
    showtimeB = await bookableShowtime(testApp, admin);
  });

  beforeEach(async () => {
    clock.set(NOW);
    await testApp.knex.raw(
      'TRUNCATE booking_notes, payments, seat_claims, booking_seats, bookings, hold_refusals, audit_events, idempotency_keys, messages CASCADE',
    );
    sender.reset();
  });

  afterAll(async () => {
    await testApp.close();
  });

  /**
   * Five bookings of every kind: a failed and an abandoned hold made at 10:00, then at 10:06 an
   * online card sale, a counter cash walk-in and a counter card-terminal sale with typed contact.
   */
  async function seedBookings() {
    const declined = await customerHold(testApp, showtimeB.showtimeId, ['C1']);
    expect(
      (
        await pay(testApp, declined.customer.authorization, declined.reference, {
          method: 'card',
          token: 'sim_card_declined',
        })
      ).body.payment.status,
    ).toBe('declined');
    const abandoned = await customerHold(testApp, showtimeA.showtimeId, ['C1']);
    clock.advance({ minutes: 6 });
    const online = await paidOnline(testApp, showtimeA.showtimeId, ['B2', 'B3'], {
      fullName: 'Nadia Farouk',
      phone: '01012345678',
    });
    clock.advance({ minutes: 1 });
    const walkIn = await counterSale(testApp, boxOffice.authorization, showtimeB.showtimeId, [
      'A2',
    ]);
    clock.advance({ minutes: 1 });
    const typed = await counterSale(
      testApp,
      boxOffice.authorization,
      showtimeA.showtimeId,
      ['D1'],
      {
        method: 'card_terminal',
        receiptReference: 'TRX-77',
        customer: { kind: 'contact', fullName: 'Omar Khaled', email: 'omar.k@example.com' },
      },
    );
    return {
      failed: declined.reference,
      abandoned: abandoned.reference,
      online: online.reference,
      onlineCustomer: online,
      walkIn: walkIn.body.booking.reference as string,
      typed: typed.body.booking.reference as string,
    };
  }

  describe('GET /admin/bookings', () => {
    it('lists every booking newest first, with its contact, showtime, seats and payment', async () => {
      const seeded = await seedBookings();
      const response = await listAdminBookings(testApp, boxOffice.authorization);

      expect(response.status).toBe(200);
      expect(references(response)).toEqual([
        seeded.typed,
        seeded.walkIn,
        seeded.online,
        seeded.abandoned,
        seeded.failed,
      ]);
      expect(response.body.total).toBe(5);
      expect(response.body.nextCursor).toBeNull();
      const online = (response.body.items as Record<string, unknown>[])[2];
      expect(online).toMatchObject({
        reference: seeded.online,
        status: 'confirmed',
        paymentStatus: 'paid',
        channel: 'online',
        owner: 'customer',
        contact: { name: 'Nadia Farouk', phone: '+201012345678' },
        showtime: { id: showtimeA.showtimeId, cinemaDate: '2026-10-11' },
        seatLabels: ['B2', 'B3'],
        seatCount: 2,
        total: { amount: 38000, currency: 'EGP' },
        payment: { method: 'card', status: 'succeeded' },
        createdAt: '2026-10-10T10:06:00+03:00',
        checkedInAt: null,
      });
      const typed = (response.body.items as Record<string, unknown>[])[0];
      expect(typed).toMatchObject({
        channel: 'counter',
        owner: 'staff',
        contact: { name: 'Omar Khaled', email: 'omar.k@example.com', phone: null },
        payment: { method: 'card_terminal', receiptReference: 'TRX-77' },
      });
    });

    it('finds a booking by reference, name, email or phone', async () => {
      const seeded = await seedBookings();
      const search = async (q: string) =>
        references(await listAdminBookings(testApp, admin.authorization, { q }));

      expect(await search(seeded.online.toLowerCase())).toEqual([seeded.online]);
      expect(await search(`  ${seeded.walkIn}  `)).toEqual([seeded.walkIn]);
      expect(await search('nadia')).toEqual([seeded.online]);
      expect(await search('FAROUK')).toEqual([seeded.online]);
      expect(await search('omar.k@')).toEqual([seeded.typed]);
      expect(await search('example.com')).toEqual([seeded.typed]);
      expect(await search('01012345678')).toEqual([seeded.online]);
      expect(await search('+2010123')).toEqual([seeded.online]);
      expect(await search('1234567')).toEqual([seeded.online]);
      expect(await search('Khaled')).toEqual([seeded.typed]);
      expect(await search('nobody-here')).toEqual([]);
      // LIKE wildcards in the text are literal: "%" matches only a "%".
      expect(await search('%%')).toEqual([]);
      expect(await search('__')).toEqual([]);
    });

    it('filters by theater, movie, status, channel, method and date', async () => {
      const seeded = await seedBookings();
      const list = async (query: Record<string, string | number>) => {
        const response = await listAdminBookings(testApp, admin.authorization, query);
        expect(response.status).toBe(200);
        expect(response.body.total).toBe(response.body.items.length);
        return references(response);
      };

      expect(await list({ theaterId: showtimeA.theaterId })).toEqual([
        seeded.typed,
        seeded.online,
        seeded.abandoned,
      ]);
      expect(await list({ movieId: showtimeB.movieId })).toEqual([seeded.walkIn, seeded.failed]);
      expect(await list({ status: 'confirmed' })).toEqual([
        seeded.typed,
        seeded.walkIn,
        seeded.online,
      ]);
      expect(await list({ status: 'failed' })).toEqual([seeded.failed]);
      expect(await list({ status: 'abandoned' })).toEqual([seeded.abandoned]);
      expect(await list({ status: 'refunded' })).toEqual([]);
      expect(await list({ channel: 'counter' })).toEqual([seeded.typed, seeded.walkIn]);
      expect(await list({ channel: 'online' })).toEqual([
        seeded.online,
        seeded.abandoned,
        seeded.failed,
      ]);
      expect(await list({ method: 'card' })).toEqual([seeded.online, seeded.failed]);
      expect(await list({ method: 'cash' })).toEqual([seeded.walkIn]);
      expect(await list({ method: 'card_terminal' })).toEqual([seeded.typed]);
      expect(await list({ method: 'wallet' })).toEqual([]);
      expect(await list({ dateFrom: '2026-10-10', dateTo: '2026-10-10' })).toHaveLength(5);
      expect(await list({ dateFrom: '2026-10-11' })).toEqual([]);
      expect(await list({ dateTo: '2026-10-09' })).toEqual([]);
      expect(
        await list({ theaterId: showtimeA.theaterId, channel: 'counter', status: 'confirmed' }),
      ).toEqual([seeded.typed]);

      // A booking refunded and shown as such: the status is decided from what is stored now.
      expect((await refundBooking(testApp, admin.authorization, seeded.online)).status).toBe(201);
      expect(await list({ status: 'refunded' })).toEqual([seeded.online]);
      // After the showtime ends, a confirmed booking is completed (a new sign-in: tokens expire).
      clock.set(new Date('2026-10-12T10:00:00+03:00'));
      const later = await signInStaff(testApp, admin.email, admin.password);
      const completed = await listAdminBookings(testApp, later.authorization, {
        status: 'completed',
      });
      expect(references(completed)).toEqual([seeded.typed, seeded.walkIn]);
      const confirmed = await listAdminBookings(testApp, later.authorization, {
        status: 'confirmed',
      });
      expect(references(confirmed)).toEqual([]);
    });

    it('counts a booking made after midnight on the cinema day before', async () => {
      clock.set(new Date('2026-10-11T01:30:00+03:00'));
      const late = await paidOnline(testApp, showtimeA.showtimeId, ['A3']);
      const staff = await signInStaff(testApp, admin.email, admin.password);
      const list = async (query: Record<string, string>) =>
        references(await listAdminBookings(testApp, staff.authorization, query));
      expect(await list({ dateFrom: '2026-10-10', dateTo: '2026-10-10' })).toEqual([
        late.reference,
      ]);
      expect(await list({ dateFrom: '2026-10-11' })).toEqual([]);
    });

    it('pages with a cursor and keeps the total', async () => {
      const seeded = await seedBookings();
      const first = await listAdminBookings(testApp, admin.authorization, { limit: 2 });
      expect(references(first)).toEqual([seeded.typed, seeded.walkIn]);
      expect(first.body.total).toBe(5);
      const second = await listAdminBookings(testApp, admin.authorization, {
        limit: 2,
        cursor: first.body.nextCursor,
      });
      expect(references(second)).toEqual([seeded.online, seeded.abandoned]);
      const third = await listAdminBookings(testApp, admin.authorization, {
        limit: 2,
        cursor: second.body.nextCursor,
      });
      expect(references(third)).toEqual([seeded.failed]);
      expect(third.body.nextCursor).toBeNull();
    });

    it('reads a page in a fixed number of queries, whatever its size', async () => {
      const countQueries = async () => {
        let count = 0;
        const listener = () => {
          count += 1;
        };
        testApp.knex.on('query', listener);
        try {
          expect((await listAdminBookings(testApp, admin.authorization)).status).toBe(200);
        } finally {
          testApp.knex.removeListener('query', listener);
        }
        return count;
      };
      await paidOnline(testApp, showtimeA.showtimeId, ['A2']);
      const one = await countQueries();
      await seedBookings();
      const six = await countQueries();
      expect(six).toBe(one);
    });

    it('refuses bad filters', async () => {
      const queries: Record<string, string | number>[] = [
        { q: 'a' },
        { q: 'x'.repeat(101) },
        { status: 'cancelled' },
        { channel: 'phone' },
        { method: 'cheque' },
        { theaterId: 0 },
        { dateFrom: '2026-02-30' },
        { dateFrom: '2026-10-12', dateTo: '2026-10-11' },
        { cursor: 'not a cursor' },
        { limit: 101 },
      ];
      for (const query of queries) {
        expectError(
          await listAdminBookings(testApp, admin.authorization, query),
          400,
          'VALIDATION_FAILED',
        );
      }
    });

    it('settles a due slow payment before listing', async () => {
      const slow = await customerHold(testApp, showtimeA.showtimeId, ['C5']);
      const paid = await pay(testApp, slow.customer.authorization, slow.reference, {
        method: 'card',
        token: 'sim_card_slow',
      });
      expect(paid.body.payment.status).toBe('processing');
      clock.advance({ seconds: 11 });
      const response = await listAdminBookings(testApp, admin.authorization);
      expect(response.body.items[0]).toMatchObject({
        reference: slow.reference,
        status: 'confirmed',
        paymentStatus: 'paid',
      });
    });
  });

  describe('GET /admin/bookings/summary', () => {
    it('counts the four cards from the seeded bookings', async () => {
      // Eight days ago: a booking refunded then, outside the 7-day card.
      clock.set(new Date('2026-10-02T12:00:00+03:00'));
      const old = await paidOnline(testApp, showtimeA.showtimeId, ['A5']);
      expect((await refundBooking(testApp, admin.authorization, old.reference)).status).toBe(201);
      // Yesterday: a sale, outside today's cards, refunded today below.
      clock.set(new Date('2026-10-09T20:00:00+03:00'));
      const yesterday = await paidOnline(testApp, showtimeA.showtimeId, ['A6']);

      clock.set(NOW);
      const seeded = await seedBookings();
      // Today: the online sale is refunded online (money back at once) and the walk-in's cash
      // refund is pending until it is paid out.
      expect((await refundBooking(testApp, admin.authorization, yesterday.reference)).status).toBe(
        201,
      );
      const walkIn = await refundBooking(testApp, admin.authorization, seeded.walkIn);
      expect(walkIn.status).toBe(201);

      const before = await testApp
        .http()
        .get('/api/v1/admin/bookings/summary')
        .set('Authorization', boxOffice.authorization);
      expect(before.status).toBe(200);
      // Paid today: online B2+B3 (2 × 190), the walk-in's A2 (150, refunded since) and the
      // terminal's D1 (230): 3 bookings. Collected today: those 760 taken, minus the 150 refunded
      // online to yesterday's sale; the walk-in's cash refund is pending, so not paid out yet.
      expect(before.body).toEqual({
        cinemaDate: '2026-10-10',
        serverTime: '2026-10-10T10:08:00+03:00',
        todayBookings: 3,
        collectedToday: { amount: 38000 + 15000 + 23000 - 15000, currency: 'EGP' },
        failedPaymentsToday: 1,
        refundedLast7Days: { bookingCount: 2, amount: { amount: 15000 + 15000, currency: 'EGP' } },
      });

      const refundId = walkIn.body.refunds[0].id as number;
      expect((await payOutRefund(testApp, admin.authorization, refundId)).status).toBe(201);
      const after = await testApp
        .http()
        .get('/api/v1/admin/bookings/summary')
        .set('Authorization', admin.authorization);
      expect(after.body.collectedToday).toEqual({
        amount: 38000 + 15000 + 23000 - 15000 - 15000,
        currency: 'EGP',
      });
    });
  });

  describe('GET /admin/bookings/{ref}', () => {
    it('shows the detail with payments, the customer card, actions and the activity log', async () => {
      const paid = await paidOnline(testApp, showtimeA.showtimeId, ['B4'], {
        fullName: 'Nadia Farouk',
      });
      const response = await testApp
        .http()
        .get(`/api/v1/admin/bookings/${paid.reference}`)
        .set('Authorization', boxOffice.authorization);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        reference: paid.reference,
        status: 'confirmed',
        contact: { name: 'Nadia Farouk' },
        customer: {
          id: paid.customerId,
          fullName: 'Nadia Farouk',
          status: 'active',
          anonymised: false,
        },
        soldBy: null,
        checkedInAt: null,
        refundable: { amount: 19000, currency: 'EGP' },
        actions: { refund: true, edit: true, resendTickets: true },
      });
      expect(response.body.ticket.qrCode).toMatch(/^MQ1\./);
      expect(response.body.payments).toEqual([
        expect.objectContaining({
          kind: 'charge',
          purpose: 'sale',
          method: 'card',
          status: 'succeeded',
          amount: { amount: 19000, currency: 'EGP' },
          refundable: { amount: 19000, currency: 'EGP' },
          card: { brand: 'visa', last4: '4242' },
          collectedBy: null,
        }),
      ]);
      const actions = (response.body.activity as { action: string }[]).map((event) => event.action);
      expect(actions[0]).toBe('booking.held');
      expect([...actions].sort()).toEqual([
        'booking.confirmed',
        'booking.held',
        'payment.succeeded',
      ]);
      expect(response.body.activity[0]).toMatchObject({ actorKind: 'customer', staff: null });
    });

    it('names the counter seller, the collector and staff in the activity log', async () => {
      const sale = await counterSale(testApp, boxOffice.authorization, showtimeA.showtimeId, [
        'A4',
      ]);
      const reference = sale.body.booking.reference as string;
      const response = await testApp
        .http()
        .get(`/api/v1/admin/bookings/${reference}`)
        .set('Authorization', admin.authorization);
      const seller = { id: boxOffice.staffUserId, fullName: 'Hany Adel' };
      expect(response.body).toMatchObject({
        customer: null,
        soldBy: seller,
        actions: { refund: true, edit: true, resendTickets: false },
      });
      expect(response.body.payments[0]).toMatchObject({ method: 'cash', collectedBy: seller });
      expect(response.body.activity[0]).toMatchObject({
        action: 'booking.held',
        actorKind: 'staff',
        staff: seller,
      });
    });

    it('answers NOT_FOUND for an unknown reference and VALIDATION_FAILED for a malformed one', async () => {
      expectError(
        await testApp
          .http()
          .get('/api/v1/admin/bookings/MQ-ZZZZZZ')
          .set('Authorization', admin.authorization),
        404,
        'NOT_FOUND',
      );
      expectError(
        await testApp
          .http()
          .get('/api/v1/admin/bookings/nope')
          .set('Authorization', admin.authorization),
        400,
        'VALIDATION_FAILED',
      );
    });
  });

  describe('notes', () => {
    const addNote = (reference: string, authorization: string, body: unknown, key = randomUUID()) =>
      testApp
        .http()
        .post(`/api/v1/admin/bookings/${reference}/notes`)
        .set('Authorization', authorization)
        .set('Idempotency-Key', key)
        .send(body as object);

    it('adds and lists notes, newest first, with their authors', async () => {
      const paid = await paidOnline(testApp, showtimeA.showtimeId, ['B6']);
      const first = await addNote(paid.reference, boxOffice.authorization, {
        body: '  Will arrive late.  ',
      });
      expect(first.status).toBe(201);
      expect(first.body).toEqual({
        id: expect.any(Number),
        body: 'Will arrive late.',
        author: { id: boxOffice.staffUserId, fullName: 'Hany Adel' },
        createdAt: '2026-10-10T10:00:00+03:00',
      });
      clock.advance({ minutes: 2 });
      await addNote(paid.reference, admin.authorization, { body: 'Called back.' });

      const list = await testApp
        .http()
        .get(`/api/v1/admin/bookings/${paid.reference}/notes`)
        .set('Authorization', boxOffice.authorization);
      expect(list.status).toBe(200);
      expect(list.body.total).toBe(2);
      expect((list.body.items as { body: string }[]).map((note) => note.body)).toEqual([
        'Called back.',
        'Will arrive late.',
      ]);
      const paged = await testApp
        .http()
        .get(`/api/v1/admin/bookings/${paid.reference}/notes`)
        .query({ limit: 1 })
        .set('Authorization', admin.authorization);
      expect(paged.body.items).toHaveLength(1);
      const next = await testApp
        .http()
        .get(`/api/v1/admin/bookings/${paid.reference}/notes`)
        .query({ limit: 1, cursor: paged.body.nextCursor })
        .set('Authorization', admin.authorization);
      expect(next.body.items[0].body).toBe('Will arrive late.');

      const audit = await testApp
        .knex('audit_events')
        .select('action', 'metadata')
        .where({ booking_id: paid.bookingId, action: 'booking.note_added' });
      expect(audit).toHaveLength(2);
      expect(JSON.stringify(audit)).not.toContain('arrive');
    });

    it('never shows notes to the customer', async () => {
      const paid = await paidOnline(testApp, showtimeA.showtimeId, ['B7']);
      await addNote(paid.reference, admin.authorization, { body: 'SECRET-NOTE-TEXT' });
      for (const path of [
        `/api/v1/bookings/${paid.reference}`,
        `/api/v1/bookings/${paid.reference}/history`,
        '/api/v1/me/bookings',
      ]) {
        const response = await testApp.http().get(path).set('Authorization', paid.authorization);
        expect(response.status).toBe(200);
        expect(JSON.stringify(response.body)).not.toContain('SECRET-NOTE-TEXT');
        expect(response.body).not.toHaveProperty('notes');
      }
      expectError(
        await testApp
          .http()
          .get(`/api/v1/admin/bookings/${paid.reference}/notes`)
          .set('Authorization', paid.authorization),
        401,
        'UNAUTHENTICATED',
      );
      expect((await readMessages(testApp.knex)).map((m) => m.body_text).join()).not.toContain(
        'SECRET-NOTE-TEXT',
      );
    });

    it('refuses an empty or too long note, a missing key and an unknown booking', async () => {
      const paid = await paidOnline(testApp, showtimeA.showtimeId, ['B8']);
      expectError(
        await addNote(paid.reference, admin.authorization, { body: '   ' }),
        400,
        'VALIDATION_FAILED',
      );
      expectError(
        await addNote(paid.reference, admin.authorization, { body: 'x'.repeat(1001) }),
        400,
        'VALIDATION_FAILED',
      );
      expectError(await addNote(paid.reference, admin.authorization, {}), 400, 'VALIDATION_FAILED');
      expectError(
        await testApp
          .http()
          .post(`/api/v1/admin/bookings/${paid.reference}/notes`)
          .set('Authorization', admin.authorization)
          .send({ body: 'No key' }),
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
      );
      expectError(await addNote('MQ-ZZZZZZ', admin.authorization, { body: 'x' }), 404, 'NOT_FOUND');
      expect(await testApp.knex('booking_notes').count({ count: '*' }).first()).toEqual({
        count: 0,
      });
    });
  });

  describe('POST /admin/bookings/{ref}/ticket-deliveries', () => {
    const resend = (reference: string, authorization: string, key = randomUUID()) =>
      testApp
        .http()
        .post(`/api/v1/admin/bookings/${reference}/ticket-deliveries`)
        .set('Authorization', authorization)
        .set('Idempotency-Key', key)
        .send();

    it('queues the tickets email and SMS to the contact, once per key', async () => {
      const paid = await paidOnline(testApp, showtimeA.showtimeId, ['C2'], {
        phone: '01012345678',
      });
      const before = (await readMessages(testApp.knex)).length;
      const key = randomUUID();
      const response = await resend(paid.reference, boxOffice.authorization, key);
      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        channels: ['email', 'sms'],
        queuedAt: '2026-10-10T10:00:00+03:00',
      });
      const queued = (await readMessages(testApp.knex)).slice(before);
      expect(queued.map((message) => [message.template, message.recipient])).toEqual([
        ['booking.tickets', expect.stringContaining('@test.maqady.local')],
        ['booking.tickets_sms', '+201012345678'],
      ]);
      const replay = await resend(paid.reference, boxOffice.authorization, key);
      expect(replay.status).toBe(201);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(await readMessages(testApp.knex)).toHaveLength(before + 2);

      const history = await testApp
        .http()
        .get(`/api/v1/bookings/${paid.reference}/history`)
        .set('Authorization', paid.authorization);
      expect((history.body.items as { kind: string }[]).map((event) => event.kind)).toContain(
        'tickets_resent',
      );
      const audit = await testApp
        .knex('audit_events')
        .first('actor_kind', 'actor_staff_user_id', 'metadata')
        .where({ booking_id: paid.bookingId, action: 'booking.tickets_resent' });
      expect(audit).toEqual({
        actor_kind: 'staff',
        actor_staff_user_id: boxOffice.staffUserId,
        metadata: { channels: 'email,sms', by: 'staff' },
      });
    });

    it('refuses a walk-in with no contact and a booking without a ticket', async () => {
      const walkIn = await counterSale(
        testApp,
        boxOffice.authorization,
        showtimeA.showtimeId,
        ['A7'],
        CASH_WALK_IN,
      );
      expectError(
        await resend(walkIn.body.booking.reference as string, boxOffice.authorization),
        409,
        'NO_CONTACT_DETAILS',
      );
      const hold = await expectHold(testApp, showtimeA.showtimeId, ['C7']);
      const held = await resend(hold.reference, boxOffice.authorization);
      expectError(held, 409, 'TICKET_NOT_AVAILABLE');
      expect(held.body.error.details).toEqual({ status: 'held' });
      expectError(await resend('MQ-ZZZZZZ', boxOffice.authorization), 404, 'NOT_FOUND');
    });
  });

  describe('access', () => {
    it('refuses a box office token on the admin-only routes', async () => {
      const paid = await paidOnline(testApp, showtimeA.showtimeId, ['D2']);
      const requests = [
        () => testApp.http().post(`/api/v1/admin/bookings/${paid.reference}/refunds`),
        () => testApp.http().post(`/api/v1/admin/bookings/${paid.reference}/edits`),
        () => testApp.http().post(`/api/v1/admin/bookings/${paid.reference}/edit-previews`),
        () => testApp.http().post('/api/v1/admin/refunds/1/payouts'),
        () =>
          testApp
            .http()
            .get(`/api/v1/admin/showtimes/${showtimeA.showtimeId}/cancellation-preview`),
      ];
      for (const request of requests) {
        const response = await request()
          .set('Authorization', boxOffice.authorization)
          .set('Idempotency-Key', randomUUID())
          .send({ reason: 'staff_error' });
        expectError(response, 403, 'FORBIDDEN');
      }
      expect(await testApp.knex('payments').where({ kind: 'refund' })).toHaveLength(0);
    });

    it('refuses a customer token on every admin booking route', async () => {
      const customer = await registerCustomer(testApp);
      for (const path of [
        '/api/v1/admin/bookings',
        '/api/v1/admin/bookings/summary',
        '/api/v1/admin/bookings/MQ-ZZZZZZ',
        '/api/v1/admin/bookings/MQ-ZZZZZZ/notes',
      ]) {
        expectError(
          await testApp.http().get(path).set('Authorization', customer.authorization),
          401,
          'UNAUTHENTICATED',
        );
      }
    });
  });
});
