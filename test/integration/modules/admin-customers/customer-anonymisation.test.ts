import type { Response } from 'supertest';
import { OutboxDrainService } from '../../../../src/modules/messaging/outbox-drain.service';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import {
  anonymiseCustomer,
  getAdminCustomer,
  listAdminCustomers,
  paidBookingOf,
  requestCustomerReset,
} from '../../../support/admin-customers';
import { counterSale } from '../../../support/box-office';
import { TestClock } from '../../../support/clock';
import {
  DEFAULT_CUSTOMER_PASSWORD,
  registerCustomer,
  signInCustomer,
} from '../../../support/customer-auth';
import { bookableShowtime } from '../../../support/holds';
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

const NOW = new Date('2026-10-10T10:00:00+03:00');
const DELETED_AT = new Date('2026-10-10T10:05:00+03:00');

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

/** Rows that point at one customer, table by table. */
interface CustomerFootprint {
  readonly sessions: number;
  readonly oneTimeTokens: number;
  readonly idempotencyKeys: number;
  readonly messages: number;
  readonly bookingNotes: number;
}

/**
 * "Delete account" (design §21; PRD Accounts 6): exactly the listed fields are nulled and the
 * listed rows deleted, in one transaction; bookings, payments and audit events stay. Real app and
 * Postgres; only Resend is replaced.
 */
describe('Customer anonymisation (integration)', () => {
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
    admin = await staffSession(testApp, 'admin');
    boxOffice = await staffSession(testApp, 'box_office');
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

  /**
   * A customer with everything anonymisation touches: two sessions, a used and an unused link, an
   * online booking and a counter sale with notes, tickets and their messages, and stored requests.
   */
  async function customerWithHistory(
    fullName: string,
    email: string,
    seats: [online: string, counter: string],
  ) {
    const customer = await registerCustomer(testApp, { fullName, email });
    await testApp
      .http()
      .patch('/api/v1/me')
      .set('Authorization', customer.authorization)
      .send({ phone: email.startsWith('karim') ? '01012345678' : '01198765432' })
      .expect(200);
    await signInCustomer(testApp, email, DEFAULT_CUSTOMER_PASSWORD);
    const online = await paidBookingOf(testApp, customer, showtime.showtimeId, [seats[0]]);
    const counter = await counterSale(
      testApp,
      boxOffice.authorization,
      showtime.showtimeId,
      [seats[1]],
      { method: 'cash', customer: { kind: 'existing', customerId: customer.customerId } },
    );
    const counterRef = counter.body.booking.reference as string;
    for (const reference of [online.reference, counterRef]) {
      await testApp
        .http()
        .post(`/api/v1/admin/bookings/${reference}/notes`)
        .set('Authorization', boxOffice.authorization)
        .set('Idempotency-Key', `note-${reference}`)
        .send({ body: `Asked for an aisle seat (${fullName}).` })
        .expect(201);
    }
    // A used reset link next to the unused verification link.
    expect(
      (await requestCustomerReset(testApp, admin.authorization, customer.customerId)).status,
    ).toBe(202);
    await testApp
      .knex('one_time_tokens')
      .where({ customer_id: customer.customerId, purpose: 'customer_password_reset' })
      .update({ used_at: NOW });
    await drain.whenIdle();
    return { customer, online, counterRef };
  }

  async function footprintOf(customerId: number): Promise<CustomerFootprint> {
    const count = async (query: PromiseLike<readonly { n?: string | number }[]>) =>
      Number((await query)[0]!.n);
    const knex = testApp.knex;
    return {
      sessions: await count(knex('sessions').count({ n: '*' }).where({ customer_id: customerId })),
      oneTimeTokens: await count(
        knex('one_time_tokens').count({ n: '*' }).where({ customer_id: customerId }),
      ),
      idempotencyKeys: await count(
        knex('idempotency_keys')
          .count({ n: '*' })
          .where({ scope: `customer:${customerId}` }),
      ),
      messages: await count(
        knex('messages').count({ n: '*' }).where({ related_customer_id: customerId }),
      ),
      bookingNotes: await count(
        knex('booking_notes')
          .count({ n: '*' })
          .whereIn('booking_id', knex('bookings').select('id').where({ customer_id: customerId })),
      ),
    };
  }

  /** Every table of the schema with its row count. */
  async function tableCounts(): Promise<Record<string, number>> {
    const { rows } = await testApp.knex.raw<{ rows: { table_name: string }[] }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`,
    );
    const counts: Record<string, number> = {};
    for (const { table_name: table } of rows) {
      const [row] = await testApp.knex(table).count<{ n: number }[]>({ n: '*' });
      counts[table] = row!.n;
    }
    return counts;
  }

  const bookingsOf = (customerId: number): Promise<Record<string, unknown>[]> =>
    testApp
      .knex('bookings')
      .select<Record<string, unknown>[]>(
        'id',
        'reference',
        'status',
        'channel',
        'customer_id',
        'seat_count',
        'total_amount',
        'currency',
        'contact_name',
        'contact_email',
        'contact_phone',
        'confirmed_at',
        'qr_version',
      )
      .where({ customer_id: customerId })
      .orderBy('id');

  const paymentsOf = (customerId: number) =>
    testApp
      .knex('payments')
      .select('payments.*')
      .whereIn(
        'booking_id',
        testApp.knex('bookings').select('id').where({ customer_id: customerId }),
      )
      .orderBy('id');

  it('nulls exactly the listed fields, deletes exactly the listed rows, and keeps bookings and payments', async () => {
    const karim = await customerWithHistory('Karim Mostafa', 'karim.m@example.com', ['B1', 'B2']);
    const salma = await customerWithHistory('Salma Adel', 'salma.a@example.com', ['C1', 'C2']);
    const karimId = karim.customer.customerId;

    const footprint = await footprintOf(karimId);
    expect(footprint).toEqual({
      sessions: 2,
      oneTimeTokens: 2,
      idempotencyKeys: expect.any(Number),
      messages: expect.any(Number),
      bookingNotes: 2,
    });
    expect(footprint.idempotencyKeys).toBeGreaterThanOrEqual(2);
    expect(footprint.messages).toBeGreaterThanOrEqual(4);
    const salmaBefore = await footprintOf(salma.customer.customerId);
    const customerBefore = await testApp.knex('customers').where({ id: karimId }).first();
    const bookingsBefore = await bookingsOf(karimId);
    expect(bookingsBefore).toHaveLength(2);
    expect(bookingsBefore[0]).toMatchObject({
      contact_name: 'Karim Mostafa',
      contact_email: 'karim.m@example.com',
      contact_phone: '+201012345678',
    });
    const paymentsBefore = await paymentsOf(karimId);
    const seatsBefore = await testApp.knex('booking_seats').orderBy(['booking_id', 'seat_label']);
    const countsBefore = await tableCounts();
    await drain.whenIdle();

    clock.set(DELETED_AT);
    const response = await anonymiseCustomer(testApp, admin.authorization, karimId);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      customerId: karimId,
      anonymisedAt: '2026-10-10T10:05:00+03:00',
      bookingsKept: 2,
      removed: { ...footprint, bookingContacts: 2 },
    });

    // The row: exactly the four personal fields and deleted_at (with updated_at) changed.
    const customerAfter = await testApp.knex('customers').where({ id: karimId }).first();
    expect(customerAfter).toEqual({
      ...customerBefore,
      email: null,
      full_name: null,
      phone: null,
      password_hash: null,
      deleted_at: DELETED_AT,
      updated_at: DELETED_AT,
    });

    // The bookings stay with their owner, seats, totals and payments; only the contact goes.
    expect(await bookingsOf(karimId)).toEqual(
      bookingsBefore.map((row) => ({
        ...row,
        contact_name: null,
        contact_email: null,
        contact_phone: null,
      })),
    );
    expect(await paymentsOf(karimId)).toEqual(paymentsBefore);
    expect(await testApp.knex('booking_seats').orderBy(['booking_id', 'seat_label'])).toEqual(
      seatsBefore,
    );

    // Exactly the listed rows went, and only Karim's: one audit event came.
    expect(await footprintOf(karimId)).toEqual({
      sessions: 0,
      oneTimeTokens: 0,
      idempotencyKeys: 0,
      messages: 0,
      bookingNotes: 0,
    });
    expect(await footprintOf(salma.customer.customerId)).toEqual(salmaBefore);
    expect(await tableCounts()).toEqual({
      ...countsBefore,
      sessions: countsBefore.sessions! - footprint.sessions,
      one_time_tokens: countsBefore.one_time_tokens! - footprint.oneTimeTokens,
      idempotency_keys: countsBefore.idempotency_keys! - footprint.idempotencyKeys,
      messages: countsBefore.messages! - footprint.messages,
      booking_notes: countsBefore.booking_notes! - footprint.bookingNotes,
      audit_events: countsBefore.audit_events! + 1,
    });
    const salmaBookings = await bookingsOf(salma.customer.customerId);
    expect(salmaBookings.map((row) => row.contact_name)).toEqual(['Salma Adel', 'Salma Adel']);

    // The audit event names fields and counts, never a value; no event holds Karim's details.
    const event = await testApp
      .knex('audit_events')
      .select('actor_staff_user_id', 'entity_type', 'entity_id', 'changed_fields', 'metadata')
      .where({ action: 'customer.anonymised' })
      .first();
    expect(event).toEqual({
      actor_staff_user_id: admin.staffUserId,
      entity_type: 'customer',
      entity_id: karimId,
      changed_fields: ['email', 'fullName', 'passwordHash', 'phone'],
      metadata: {
        bookingsKept: 2,
        sessionsDeleted: footprint.sessions,
        linksDeleted: footprint.oneTimeTokens,
        idempotencyKeysDeleted: footprint.idempotencyKeys,
        messagesDeleted: footprint.messages,
        notesDeleted: footprint.bookingNotes,
        contactsCleared: 2,
      },
    });
    const everyEvent = JSON.stringify(await testApp.knex('audit_events').select('*'));
    for (const value of ['Karim', 'karim.m@example.com', '+201012345678']) {
      expect(everyEvent).not.toContain(value);
    }
  });

  it('signs the customer out, refuses their sign-in, frees their email and hides them', async () => {
    const { customer, online } = await customerWithHistory('Karim Mostafa', 'karim.m@example.com', [
      'B1',
      'B2',
    ]);
    expect(
      (await anonymiseCustomer(testApp, admin.authorization, customer.customerId)).status,
    ).toBe(200);

    expectError(
      await testApp.http().get('/api/v1/me').set('Authorization', customer.authorization),
      401,
      'UNAUTHENTICATED',
    );
    expectError(
      await testApp
        .http()
        .post('/api/v1/auth/tokens')
        .send({ refreshToken: customer.refreshToken }),
      401,
      'UNAUTHENTICATED',
    );
    expectError(
      await testApp
        .http()
        .post('/api/v1/auth/sessions')
        .send({ email: customer.email, password: DEFAULT_CUSTOMER_PASSWORD }),
      401,
      'INVALID_CREDENTIALS',
    );

    expect((await listAdminCustomers(testApp, admin.authorization)).body.total).toBe(0);
    expectError(
      await getAdminCustomer(testApp, admin.authorization, customer.customerId),
      404,
      'NOT_FOUND',
    );
    expectError(
      await anonymiseCustomer(testApp, admin.authorization, customer.customerId),
      404,
      'NOT_FOUND',
    );

    // The booking stays, without its contact, on the admin booking detail.
    const detail = await testApp
      .http()
      .get(`/api/v1/admin/bookings/${online.reference}`)
      .set('Authorization', admin.authorization);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      status: 'confirmed',
      contact: { name: null, email: null, phone: null },
      customer: { id: customer.customerId, fullName: null, email: null, anonymised: true },
    });

    const registered = await testApp
      .http()
      .post('/api/v1/auth/registrations')
      .send({ fullName: 'Karim Again', email: 'KARIM.M@example.com', password: 'Passw0rd-new' });
    expect(registered.status).toBe(201);
    expect(registered.body.customer.id).not.toBe(customer.customerId);
  });

  it('answers NOT_FOUND for an unknown customer and changes nothing', async () => {
    const before = await tableCounts();
    expectError(await anonymiseCustomer(testApp, admin.authorization, 999999), 404, 'NOT_FOUND');
    expect(await tableCounts()).toEqual(before);
  });

  it('anonymises a customer who never booked', async () => {
    const customer: CustomerSessionFixture = await registerCustomer(testApp);
    const response = await anonymiseCustomer(testApp, admin.authorization, customer.customerId);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      bookingsKept: 0,
      removed: { sessions: 1, oneTimeTokens: 1, bookingNotes: 0, bookingContacts: 0 },
    });
  });
});
