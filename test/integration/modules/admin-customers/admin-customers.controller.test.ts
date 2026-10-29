import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { OutboxDrainService } from '../../../../src/modules/messaging/outbox-drain.service';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import {
  getAdminCustomer,
  listAdminCustomers,
  paidBookingOf,
  requestCustomerReset,
  updateAdminCustomer,
} from '../../../support/admin-customers';
import { listAdminBookings, refundBooking } from '../../../support/admin-bookings';
import { scanTicket } from '../../../support/box-office';
import { TestClock } from '../../../support/clock';
import {
  customerLinkToken,
  DEFAULT_CUSTOMER_PASSWORD,
  registerCustomer,
  signInCustomer,
} from '../../../support/customer-auth';
import { bookableShowtime, expectHold, holdSeats } from '../../../support/holds';
import { readMessages } from '../../../support/messaging/messages';
import { RecordingEmailSender } from '../../../support/messaging/recording-email-sender';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type {
  BookableShowtimeFixture,
  CustomerSessionFixture,
  StaffSession,
  TestApp,
} from '../../../support/types';

jest.setTimeout(180_000);

/** Saturday 10 October 2026, 10:00 Cairo time; the shows are on the 11th at 19:30 (120 min). */
const NOW = new Date('2026-10-10T10:00:00+03:00');
/** Inside the scan window of the 19:30 show (it opens at 18:30). */
const AT_DOOR = new Date('2026-10-11T19:10:00+03:00');
/** After the 19:30 show ended at 21:30. */
const AFTER_SHOW = new Date('2026-10-11T22:00:00+03:00');

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

const ids = (response: Response): number[] =>
  (response.body.items as { id: number }[]).map((item) => item.id);

/**
 * The admin Customers page (design §11; PRD A7): the list with search and the status filter, the
 * drawer with its numbers and recent bookings, edits, block and unblock, the reset email and the
 * role rules. Real app and Postgres; only Resend is replaced.
 */
describe('Admin customers (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let boxOffice: StaffSession;
  let showtime: BookableShowtimeFixture;
  let drain: OutboxDrainService;
  const clock = new TestClock(NOW);
  const sender = new RecordingEmailSender();

  beforeAll(async () => {
    testApp = await createTestApp({
      clock,
      overrides: [{ provide: EmailSender, useValue: sender }],
    });
    drain = testApp.app.get(OutboxDrainService);
    admin = await staffSession(testApp, 'admin', { fullName: 'Mona Saeed' });
    boxOffice = await staffSession(testApp, 'box_office', { fullName: 'Hany Adel' });
    showtime = await bookableShowtime(testApp, admin);
  });

  beforeEach(async () => {
    clock.set(NOW);
    await testApp.knex.raw(
      'TRUNCATE booking_notes, payments, seat_claims, booking_seats, bookings, hold_refusals, audit_events, idempotency_keys, messages',
    );
    await testApp.knex('sessions').whereNotNull('customer_id').delete();
    await testApp.knex('one_time_tokens').whereNotNull('customer_id').delete();
    await testApp.knex('customers').delete();
  });

  afterEach(async () => {
    await drain.whenIdle();
    sender.reset();
  });

  afterAll(async () => {
    await testApp.close();
  });

  /** Three customers a minute apart: Layla (with a phone), then Omar, then Nadia. */
  async function seedCustomers() {
    const layla = await registerCustomer(testApp, {
      fullName: 'Layla Hassan',
      email: 'layla.hassan@example.com',
    });
    const phone = await testApp
      .http()
      .patch('/api/v1/me')
      .set('Authorization', layla.authorization)
      .send({ phone: '01012345678' });
    expect(phone.status).toBe(200);
    clock.advance({ minutes: 1 });
    const omar = await registerCustomer(testApp, {
      fullName: 'Omar Khaled',
      email: 'omar.k@mail.example.org',
    });
    clock.advance({ minutes: 1 });
    const nadia = await registerCustomer(testApp, {
      fullName: 'Nadia Farouk',
      email: 'nadia_f@example.com',
    });
    return { layla, omar, nadia };
  }

  const block = (customerId: number, status: 'blocked' | 'active' = 'blocked') =>
    updateAdminCustomer(testApp, admin.authorization, customerId, { status });

  describe('GET /admin/customers', () => {
    it('lists live customers newest first with their details and numbers, paged with a total', async () => {
      const { layla, omar, nadia } = await seedCustomers();

      const response = await listAdminCustomers(testApp, boxOffice.authorization);
      expect(response.status).toBe(200);
      expect(ids(response)).toEqual([nadia.customerId, omar.customerId, layla.customerId]);
      expect(response.body).toMatchObject({ total: 3, nextCursor: null });
      expect(response.body.items[2]).toEqual({
        id: layla.customerId,
        fullName: 'Layla Hassan',
        email: 'layla.hassan@example.com',
        phone: '+201012345678',
        status: 'active',
        emailVerified: false,
        emailVerifiedAt: null,
        joinedAt: '2026-10-10T10:00:00+03:00',
        lastSignInAt: '2026-10-10T10:00:00+03:00',
        updatedAt: '2026-10-10T10:00:00+03:00',
        stats: {
          bookings: 0,
          spent: { amount: 0, currency: 'EGP' },
          noShows: 0,
          lastBookingAt: null,
        },
      });

      const first = await listAdminCustomers(testApp, admin.authorization, { limit: 2 });
      expect(ids(first)).toEqual([nadia.customerId, omar.customerId]);
      expect(first.body.total).toBe(3);
      const second = await listAdminCustomers(testApp, admin.authorization, {
        limit: 2,
        cursor: first.body.nextCursor as string,
      });
      expect(ids(second)).toEqual([layla.customerId]);
      expect(second.body).toMatchObject({ total: 3, nextCursor: null });
    });

    it('finds a customer by part of the name, email or phone, in any case', async () => {
      const { layla, omar, nadia } = await seedCustomers();
      const search = async (q: string) =>
        ids(await listAdminCustomers(testApp, admin.authorization, { q }));

      expect(await search('layla')).toEqual([layla.customerId]);
      expect(await search('KHALED')).toEqual([omar.customerId]);
      expect(await search('mail.example.org')).toEqual([omar.customerId]);
      expect(await search('example.com')).toEqual([nadia.customerId, layla.customerId]);
      expect(await search('01012345678')).toEqual([layla.customerId]);
      expect(await search('+2010123')).toEqual([layla.customerId]);
      expect(await search('  45678 ')).toEqual([layla.customerId]);
      expect(await search('nobody-here')).toEqual([]);
      // LIKE wildcards in the text are literal: "_" matches only an underscore.
      expect(await search('a_f')).toEqual([nadia.customerId]);
      expect(await search('__')).toEqual([]);
      expect(await search('%%')).toEqual([]);
    });

    it('filters by status, combines it with the search, and never lists an anonymised account', async () => {
      const { layla, omar, nadia } = await seedCustomers();
      expect((await block(omar.customerId)).status).toBe(200);
      await testApp
        .http()
        .delete(`/api/v1/admin/customers/${nadia.customerId}`)
        .set('Authorization', admin.authorization)
        .expect(200);

      const list = async (query: Record<string, string>) => {
        const response = await listAdminCustomers(testApp, admin.authorization, query);
        expect(response.status).toBe(200);
        expect(response.body.total).toBe(response.body.items.length);
        return ids(response);
      };
      expect(await list({})).toEqual([omar.customerId, layla.customerId]);
      expect(await list({ status: 'blocked' })).toEqual([omar.customerId]);
      expect(await list({ status: 'active' })).toEqual([layla.customerId]);
      expect(await list({ status: 'active', q: 'omar' })).toEqual([]);
      expect(await list({ q: 'nadia' })).toEqual([]);
    });

    it('refuses a bad search, status, cursor or page size', async () => {
      const queries: Record<string, string | number>[] = [
        { q: 'a' },
        { q: 'x'.repeat(101) },
        { status: 'deleted' },
        { cursor: 'not-a-cursor' },
        { limit: 0 },
        { limit: 101 },
      ];
      for (const query of queries) {
        const response = await listAdminCustomers(testApp, admin.authorization, query);
        expectError(response, 400, 'VALIDATION_FAILED');
      }
    });
  });

  describe('the numbers and the drawer', () => {
    /** Layla holds three paid bookings of the show (one refunded) and an abandoned hold. */
    async function bookingsOfLayla(layla: CustomerSessionFixture) {
      const first = await paidBookingOf(testApp, layla, showtime.showtimeId, ['B1', 'B2']);
      clock.advance({ minutes: 1 });
      const second = await paidBookingOf(testApp, layla, showtime.showtimeId, ['C1']);
      clock.advance({ minutes: 1 });
      const refunded = await paidBookingOf(testApp, layla, showtime.showtimeId, ['C2']);
      expect((await refundBooking(testApp, admin.authorization, refunded.reference)).status).toBe(
        201,
      );
      clock.advance({ minutes: 1 });
      const abandoned = await expectHold(testApp, showtime.showtimeId, ['C3'], {
        authorization: layla.authorization,
      });
      return { first, second, refunded, abandoned: abandoned.reference };
    }

    it('counts paid bookings, money spent and no-shows: the shows that ended, never scanned', async () => {
      const { layla, omar } = await seedCustomers();
      const bookings = await bookingsOfLayla(layla);

      const before = await getAdminCustomer(testApp, boxOffice.authorization, layla.customerId);
      expect(before.status).toBe(200);
      expect(before.body.stats).toEqual({
        bookings: 2,
        spent: { amount: 19000 * 3, currency: 'EGP' },
        noShows: 0,
        lastBookingAt: '2026-10-10T10:03:00+03:00',
      });

      // Access tokens last 15 minutes: staff sign in again on the day of the show.
      clock.set(AT_DOOR);
      const scanner = await staffSession(testApp, 'box_office');
      const scanned = await scanTicket(testApp, scanner.authorization, {
        theaterId: showtime.theaterId,
        reference: bookings.second.reference,
        confirm: true,
      });
      expect(scanned.body.result).toBe('VALID');

      clock.set(AFTER_SHOW);
      const lateAdmin = await staffSession(testApp, 'admin');
      const list = await listAdminCustomers(testApp, lateAdmin.authorization);
      const stats = new Map(
        (list.body.items as { id: number; stats: unknown }[]).map((item) => [item.id, item.stats]),
      );
      expect(stats.get(layla.customerId)).toEqual({
        bookings: 2,
        spent: { amount: 57000, currency: 'EGP' },
        noShows: 1,
        lastBookingAt: '2026-10-10T10:03:00+03:00',
      });
      expect(stats.get(omar.customerId)).toEqual({
        bookings: 0,
        spent: { amount: 0, currency: 'EGP' },
        noShows: 0,
        lastBookingAt: null,
      });
    });

    it("shows the customer's newest four bookings in any status, and all of them by customerId", async () => {
      const { layla } = await seedCustomers();
      const bookings = await bookingsOfLayla(layla);
      // The hold made at 10:05 has ended (10:10); Layla's token (10:00) lasts until 10:15.
      clock.advance({ minutes: 6 });
      const later = await paidBookingOf(testApp, layla, showtime.showtimeId, ['D1']);
      const other = await registerCustomer(testApp);
      await paidBookingOf(testApp, other, showtime.showtimeId, ['D2']);

      const drawer = await getAdminCustomer(testApp, admin.authorization, layla.customerId);
      expect(drawer.status).toBe(200);
      const recent = drawer.body.recentBookings as { reference: string; status: string }[];
      expect(recent.map((item) => [item.reference, item.status])).toEqual([
        [later.reference, 'confirmed'],
        [bookings.abandoned, 'abandoned'],
        [bookings.refunded.reference, 'refunded'],
        [bookings.second.reference, 'confirmed'],
      ]);
      expect(drawer.body.recentBookings[0]).toMatchObject({
        owner: 'customer',
        contact: { name: 'Layla Hassan', phone: '+201012345678' },
        seatLabels: ['D1'],
        total: { amount: 23000, currency: 'EGP' },
      });

      const all = await listAdminBookings(testApp, boxOffice.authorization, {
        customerId: layla.customerId,
      });
      expect(all.body.total).toBe(5);
      expect((all.body.items as { reference: string }[]).map((item) => item.reference)).toEqual([
        later.reference,
        bookings.abandoned,
        bookings.refunded.reference,
        bookings.second.reference,
        bookings.first.reference,
      ]);
    });

    it('answers NOT_FOUND for an unknown or anonymised customer', async () => {
      const { layla } = await seedCustomers();
      expectError(await getAdminCustomer(testApp, admin.authorization, 999999), 404, 'NOT_FOUND');
      await testApp
        .http()
        .delete(`/api/v1/admin/customers/${layla.customerId}`)
        .set('Authorization', admin.authorization)
        .expect(200);
      expectError(
        await getAdminCustomer(testApp, admin.authorization, layla.customerId),
        404,
        'NOT_FOUND',
      );
      for (const body of [{ fullName: 'Someone' }, { status: 'blocked' }]) {
        expectError(
          await updateAdminCustomer(testApp, admin.authorization, layla.customerId, body),
          404,
          'NOT_FOUND',
        );
      }
      expectError(
        await requestCustomerReset(testApp, admin.authorization, layla.customerId),
        404,
        'NOT_FOUND',
      );
    });
  });

  describe('PATCH /admin/customers/{id}', () => {
    const tokenRows = (customerId: number) =>
      testApp
        .knex('one_time_tokens')
        .select<{ purpose: string }[]>('purpose')
        .where({ customer_id: customerId });

    it('edits the name, email and phone; a new email is unverified and its old links stop working', async () => {
      const { layla } = await seedCustomers();
      await testApp
        .knex('customers')
        .where({ id: layla.customerId })
        .update({ email_verified_at: NOW });
      expect(await tokenRows(layla.customerId)).toEqual([{ purpose: 'verify_email' }]);
      clock.advance({ minutes: 5 });

      const response = await updateAdminCustomer(testApp, admin.authorization, layla.customerId, {
        fullName: '  Layla H. Mansour ',
        email: 'layla.mansour@example.com',
        phone: '01198765432',
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: layla.customerId,
        fullName: 'Layla H. Mansour',
        email: 'layla.mansour@example.com',
        phone: '+201198765432',
        emailVerified: false,
        emailVerifiedAt: null,
        updatedAt: '2026-10-10T10:07:00+03:00',
        stats: { bookings: 0 },
      });
      expect(await tokenRows(layla.customerId)).toEqual([]);
      const signedIn = await testApp
        .http()
        .post('/api/v1/auth/sessions')
        .send({ email: 'LAYLA.MANSOUR@example.com', password: DEFAULT_CUSTOMER_PASSWORD });
      expect(signedIn.status).toBe(201);

      const events = await testApp
        .knex('audit_events')
        .select('action', 'actor_staff_user_id', 'entity_id', 'changed_fields', 'metadata')
        .where({ action: 'customer.updated' });
      expect(events).toEqual([
        {
          action: 'customer.updated',
          actor_staff_user_id: admin.staffUserId,
          entity_id: layla.customerId,
          changed_fields: ['email', 'fullName', 'phone'],
          metadata: {},
        },
      ]);
    });

    it('keeps the verification on a change of letter case, removes a phone, and writes nothing for equal values', async () => {
      const { layla } = await seedCustomers();
      await testApp
        .knex('customers')
        .where({ id: layla.customerId })
        .update({ email_verified_at: NOW });

      const recased = await updateAdminCustomer(testApp, admin.authorization, layla.customerId, {
        email: 'Layla.Hassan@Example.com',
        phone: null,
      });
      expect(recased.body).toMatchObject({
        email: 'Layla.Hassan@Example.com',
        emailVerified: true,
        phone: null,
      });
      expect(await tokenRows(layla.customerId)).toEqual([{ purpose: 'verify_email' }]);

      clock.advance({ minutes: 1 });
      const same = await updateAdminCustomer(testApp, admin.authorization, layla.customerId, {
        fullName: 'Layla Hassan',
        status: 'active',
      });
      expect(same.status).toBe(200);
      expect(same.body.updatedAt).toBe(recased.body.updatedAt);
      expect(
        await testApp.knex('audit_events').count({ n: '*' }).where({ action: 'customer.updated' }),
      ).toEqual([{ n: 1 }]);
    });

    it('refuses an email another live account uses, whatever its case, and changes nothing', async () => {
      const { layla, omar } = await seedCustomers();
      const response = await updateAdminCustomer(testApp, admin.authorization, layla.customerId, {
        fullName: 'Changed',
        email: 'OMAR.K@mail.example.org',
      });
      expectError(response, 409, 'EMAIL_TAKEN');
      const row = await testApp
        .knex('customers')
        .select('full_name', 'email')
        .where({ id: layla.customerId })
        .first();
      expect(row).toEqual({ full_name: 'Layla Hassan', email: 'layla.hassan@example.com' });
      expect(omar.customerId).toBeGreaterThan(0);
    });

    it('refuses an empty body and invalid fields', async () => {
      const { layla } = await seedCustomers();
      for (const body of [
        {},
        { fullName: '   ' },
        { fullName: null },
        { email: 'not-an-email' },
        { phone: '12345' },
        { status: 'deleted' },
        { note: 'unknown field' },
      ]) {
        const response = await updateAdminCustomer(
          testApp,
          admin.authorization,
          layla.customerId,
          body,
        );
        expectError(response, 400, 'VALIDATION_FAILED');
      }
      const empty = await updateAdminCustomer(testApp, admin.authorization, layla.customerId, {});
      expect(empty.body.error.details.fields).toEqual([
        { field: 'fullName', messages: ['send fullName, email, phone or status'] },
      ]);
    });

    it('blocking signs the customer out everywhere and refuses sign-in and refresh; unblocking restores sign-in', async () => {
      const { layla } = await seedCustomers();
      const second = await signInCustomer(testApp, layla.email, DEFAULT_CUSTOMER_PASSWORD);
      const me = (authorization: string) =>
        testApp.http().get('/api/v1/me').set('Authorization', authorization);
      const signIn = () =>
        testApp
          .http()
          .post('/api/v1/auth/sessions')
          .send({ email: layla.email, password: DEFAULT_CUSTOMER_PASSWORD });
      const refresh = (refreshToken: string) =>
        testApp.http().post('/api/v1/auth/tokens').send({ refreshToken });
      expect((await me(second.authorization)).status).toBe(200);

      const blocked = await block(layla.customerId);
      expect(blocked.status).toBe(200);
      expect(blocked.body.status).toBe('blocked');
      const sessions = await testApp
        .knex('sessions')
        .select('revoked_reason')
        .where({ customer_id: layla.customerId });
      expect(sessions).toEqual([
        { revoked_reason: 'account_blocked' },
        { revoked_reason: 'account_blocked' },
      ]);
      expectError(await me(layla.authorization), 403, 'ACCOUNT_BLOCKED');
      expectError(await me(second.authorization), 403, 'ACCOUNT_BLOCKED');
      expectError(await signIn(), 403, 'ACCOUNT_BLOCKED');
      expectError(await refresh(second.refreshToken), 403, 'ACCOUNT_BLOCKED');
      expectError(
        await holdSeats(testApp, showtime.showtimeId, ['A2'], {
          authorization: second.authorization,
        }),
        403,
        'ACCOUNT_BLOCKED',
      );

      const unblocked = await block(layla.customerId, 'active');
      expect(unblocked.body.status).toBe('active');
      const again = await signIn();
      expect(again.status).toBe(201);
      expect((await me(`Bearer ${again.body.accessToken as string}`)).status).toBe(200);
      // The sessions the block ended stay ended.
      expectError(await me(second.authorization), 401, 'SESSION_REVOKED');

      const events = await testApp
        .knex('audit_events')
        .select('metadata')
        .where({ action: 'customer.status_changed', entity_id: layla.customerId })
        .orderBy('id');
      expect(events).toEqual([
        { metadata: { status: 'blocked' } },
        { metadata: { status: 'active' } },
      ]);
    });
  });

  describe('POST /admin/customers/{id}/password-reset-requests', () => {
    it('queues the reset email with the link hidden in the stored copy, and the emailed link works', async () => {
      const { layla } = await seedCustomers();
      await drain.whenIdle();
      sender.reset();
      await testApp.knex('messages').delete();
      const key = randomUUID();

      const response = await requestCustomerReset(
        testApp,
        admin.authorization,
        layla.customerId,
        key,
      );
      expect(response.status).toBe(202);
      expect(response.body).toEqual({ channel: 'email', queuedAt: '2026-10-10T10:02:00+03:00' });

      const replay = await requestCustomerReset(
        testApp,
        admin.authorization,
        layla.customerId,
        key,
      );
      expect(replay.status).toBe(202);
      expect(replay.headers['idempotent-replayed']).toBe('true');

      const messages = await readMessages(testApp.knex);
      expect(messages).toHaveLength(1);
      const [message] = messages;
      expect(message).toMatchObject({
        channel: 'email',
        template: 'customer.password_reset',
        recipient: 'layla.hassan@example.com',
        related_customer_id: layla.customerId,
      });
      expect(message!.body_text).toContain('[one-time link hidden]');
      expect(message!.body_text).not.toContain('token=');
      expect(message!.body_html).not.toContain('token=');

      await drain.whenIdle();
      const emails = sender.calls.filter((call) => call.to === 'layla.hassan@example.com');
      expect(emails).toHaveLength(1);
      const token = customerLinkToken(emails[0]!.text, '/reset-password');
      const reset = await testApp
        .http()
        .post('/api/v1/auth/password-resets')
        .send({ token, password: 'NewPassw0rd' });
      expect(reset.status).toBe(204);
      const signedIn = await testApp
        .http()
        .post('/api/v1/auth/sessions')
        .send({ email: layla.email, password: 'NewPassw0rd' });
      expect(signedIn.status).toBe(201);

      const events = await testApp
        .knex('audit_events')
        .select('actor_staff_user_id', 'entity_id', 'metadata')
        .where({ action: 'customer.password_reset_sent' });
      expect(events).toEqual([
        { actor_staff_user_id: admin.staffUserId, entity_id: layla.customerId, metadata: {} },
      ]);
    });

    it('refuses a blocked customer with CUSTOMER_BLOCKED and sends nothing', async () => {
      const { layla } = await seedCustomers();
      await block(layla.customerId);
      await testApp.knex('messages').delete();

      const response = await requestCustomerReset(testApp, admin.authorization, layla.customerId);
      expectError(response, 409, 'CUSTOMER_BLOCKED');
      expect(await readMessages(testApp.knex)).toEqual([]);
      expect(
        await testApp
          .knex('one_time_tokens')
          .where({ customer_id: layla.customerId, purpose: 'customer_password_reset' }),
      ).toEqual([]);
    });

    it('requires an Idempotency-Key', async () => {
      const { layla } = await seedCustomers();
      const response = await testApp
        .http()
        .post(`/api/v1/admin/customers/${layla.customerId}/password-reset-requests`)
        .set('Authorization', admin.authorization)
        .send();
      expectError(response, 400, 'IDEMPOTENCY_KEY_REQUIRED');
    });
  });

  describe('access', () => {
    it('lets box office read customers, and refuses every admin action with FORBIDDEN', async () => {
      const { layla } = await seedCustomers();
      expect((await listAdminCustomers(testApp, boxOffice.authorization)).status).toBe(200);
      expect(
        (await getAdminCustomer(testApp, boxOffice.authorization, layla.customerId)).status,
      ).toBe(200);

      expectError(
        await updateAdminCustomer(testApp, boxOffice.authorization, layla.customerId, {
          status: 'blocked',
        }),
        403,
        'FORBIDDEN',
      );
      expectError(
        await testApp
          .http()
          .delete(`/api/v1/admin/customers/${layla.customerId}`)
          .set('Authorization', boxOffice.authorization),
        403,
        'FORBIDDEN',
      );
      expectError(
        await requestCustomerReset(testApp, boxOffice.authorization, layla.customerId),
        403,
        'FORBIDDEN',
      );
      const row = await testApp
        .knex('customers')
        .select('status', 'deleted_at')
        .where({ id: layla.customerId })
        .first();
      expect(row).toEqual({ status: 'active', deleted_at: null });
      expect(
        await testApp
          .knex('one_time_tokens')
          .where({ customer_id: layla.customerId, purpose: 'customer_password_reset' }),
      ).toEqual([]);
    });

    it('refuses a customer token and no token on every admin customer route', async () => {
      const { layla } = await seedCustomers();
      const routes: [method: 'get' | 'patch' | 'delete' | 'post', path: string][] = [
        ['get', '/api/v1/admin/customers'],
        ['get', `/api/v1/admin/customers/${layla.customerId}`],
        ['patch', `/api/v1/admin/customers/${layla.customerId}`],
        ['delete', `/api/v1/admin/customers/${layla.customerId}`],
        ['post', `/api/v1/admin/customers/${layla.customerId}/password-reset-requests`],
      ];
      for (const [method, path] of routes) {
        expectError(
          await testApp.http()[method](path).set('Authorization', layla.authorization).send({}),
          401,
          'UNAUTHENTICATED',
        );
        expectError(await testApp.http()[method](path).send({}), 401, 'UNAUTHENTICATED');
      }
    });
  });
});
