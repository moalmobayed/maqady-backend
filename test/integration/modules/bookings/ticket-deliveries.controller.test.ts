import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import { OutboxDrainService } from '../../../../src/modules/messaging/outbox-drain.service';
import { customerHold, pay } from '../../../support/checkout';
import { TestClock } from '../../../support/clock';
import { registerCustomer, signInCustomer } from '../../../support/customer-auth';
import { bookableShowtime, expectHold } from '../../../support/holds';
import { createLogCapture } from '../../../support/log-capture';
import { readMessages } from '../../../support/messaging/messages';
import { RecordingEmailSender, waitFor } from '../../../support/messaging/recording-email-sender';
import { emailAgain, paidBooking } from '../../../support/my-bookings';
import { cancelShowtime } from '../../../support/showtimes';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { buildTestConfig, TEST_FRONTEND_BASE_URL } from '../../../support/test-config';
import type {
  BookableShowtimeFixture,
  CustomerHoldFixture,
  LogCapture,
  StaffSession,
  StoredMessage,
  TestApp,
} from '../../../support/types';

jest.setTimeout(240_000);

const NOW = new Date('2026-10-10T10:00:00+03:00');
const REDACTED = '[one-time link hidden]';
const FULL_NAME = 'Mona Private Adel';
const PHONE = '01012345678';

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

/**
 * "Email again" (PRD C11, "Email and SMS"; design §10.6, §11, §13.1): one tickets email per
 * idempotent request to the account email, never SMS, 3 an hour per booking and caller, only for
 * the owner's confirmed or completed booking, audited for the History, with no personal data in
 * the logs. Real app and Postgres with the design's limit (`RATE_LIMIT_TICKET_EMAIL=3/1h`); only
 * Resend is replaced (`RecordingEmailSender`).
 */
describe('POST /bookings/{ref}/ticket-deliveries (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let showtime: BookableShowtimeFixture;
  let logs: LogCapture;
  const clock = new TestClock(NOW);
  const sender = new RecordingEmailSender();

  /** A customer with a phone on file and a confirmed booking of `seats`. */
  const confirmed = async (seats: string[]): Promise<CustomerHoldFixture> => {
    const fixture = await customerHold(testApp, showtime.showtimeId, seats, {
      phone: PHONE,
      fullName: FULL_NAME,
    });
    expect((await pay(testApp, fixture.customer.authorization, fixture.reference)).status).toBe(
      201,
    );
    await testApp.app.get(OutboxDrainService).whenIdle();
    return fixture;
  };
  const ticketMessages = async (bookingId: number): Promise<StoredMessage[]> =>
    (await readMessages(testApp.knex)).filter(
      (message) =>
        message.related_booking_id === bookingId && message.template.startsWith('booking.tickets'),
    );
  const ticketEmailsTo = (address: string) =>
    sender.calls.filter(
      (email) => email.to === address && email.subject.startsWith('Your Maqady tickets'),
    );

  beforeAll(async () => {
    logs = createLogCapture();
    testApp = await createTestApp({
      clock,
      config: buildTestConfig({ logLevel: 'debug' }, { RATE_LIMIT_TICKET_EMAIL: '3/1h' }),
      logDestination: logs.stream,
      overrides: [{ provide: EmailSender, useValue: sender }],
    });
    admin = await staffSession(testApp, 'admin');
    showtime = await bookableShowtime(testApp, admin);
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

  it('queues one tickets email to the account email, no SMS, sends it after the response and audits it', async () => {
    const { customer, bookingId, reference } = await confirmed(['B2', 'B3']);
    const before = await ticketMessages(bookingId);
    expect(before.map((message) => message.channel)).toEqual(['email', 'sms']);
    sender.reset();

    const response = await emailAgain(testApp, customer.authorization, reference);
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ channel: 'email', queuedAt: '2026-10-10T10:00:00+03:00' });

    const added = (await ticketMessages(bookingId)).slice(before.length);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      channel: 'email',
      template: 'booking.tickets',
      recipient: customer.email,
      related_booking_id: bookingId,
      related_customer_id: customer.customerId,
    });
    expect(added[0]!.body_text).toContain(REDACTED);
    expect(added[0]!.body_text).not.toContain('/ticket?token=');

    await waitFor(() => ticketEmailsTo(customer.email).length === 1);
    expect(ticketEmailsTo(customer.email)[0]!.text).toContain(
      `${TEST_FRONTEND_BASE_URL}/ticket?token=`,
    );
    expect(sender.calls).toHaveLength(1);

    const audit = await testApp
      .knex('audit_events')
      .select('actor_kind', 'actor_customer_id', 'entity_type', 'entity_id', 'metadata')
      .where({ booking_id: bookingId, action: 'booking.tickets_resent' });
    expect(audit).toEqual([
      {
        actor_kind: 'customer',
        actor_customer_id: customer.customerId,
        entity_type: 'booking',
        entity_id: bookingId,
        metadata: { channel: 'email' },
      },
    ]);
  });

  it('keeps sending to the account email when the booking contact changed', async () => {
    const { customer, bookingId, reference } = await confirmed(['B4']);
    await testApp
      .knex('bookings')
      .where({ id: bookingId })
      .update({ contact_email: 'someone.else@example.com' });

    expect((await emailAgain(testApp, customer.authorization, reference)).status).toBe(201);
    const [, , resent] = await ticketMessages(bookingId);
    expect(resent!.recipient).toBe(customer.email);
  });

  it('replays the same Idempotency-Key without queueing again, also for 5 parallel requests', async () => {
    const { customer, bookingId, reference } = await confirmed(['B5']);
    const key = randomUUID();
    const first = await emailAgain(testApp, customer.authorization, reference, key);
    expect(first.status).toBe(201);
    const replay = await emailAgain(testApp, customer.authorization, reference, key);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    expect(await ticketMessages(bookingId)).toHaveLength(3);

    const other = await confirmed(['B6']);
    const parallelKey = randomUUID();
    const answers = await Promise.all(
      Array.from({ length: 5 }, () =>
        emailAgain(testApp, other.customer.authorization, other.reference, parallelKey),
      ),
    );
    // The limit is 3 an hour, so some of the five may be refused; never more than one email.
    expect(answers.filter((answer) => answer.status === 201).length).toBeGreaterThanOrEqual(1);
    for (const answer of answers) expect([201, 429]).toContain(answer.status);
    expect(await ticketMessages(other.bookingId)).toHaveLength(3);
  });

  it('allows 3 an hour per booking, the 4th RATE_LIMITED with Retry-After and nothing queued', async () => {
    const { customer, bookingId, reference } = await confirmed(['C2']);
    const intruder = await registerCustomer(testApp);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expectError(await emailAgain(testApp, intruder.authorization, reference), 404, 'NOT_FOUND');
      expectError(await emailAgain(testApp, undefined, reference), 401, 'UNAUTHENTICATED');
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await emailAgain(testApp, customer.authorization, reference)).status).toBe(201);
    }
    const fourth = await emailAgain(testApp, customer.authorization, reference);
    expectError(fourth, 429, 'RATE_LIMITED');
    expect(Number(fourth.headers['retry-after'])).toBeGreaterThan(0);
    expect(await ticketMessages(bookingId)).toHaveLength(2 + 3);
  });

  it('answers TICKET_NOT_AVAILABLE with the status for a booking without a ticket, queueing nothing', async () => {
    const customer = await registerCustomer(testApp);
    const auth = customer.authorization;
    const declined = { method: 'card', token: 'sim_card_declined' };

    const held = await expectHold(testApp, showtime.showtimeId, ['C3'], { authorization: auth });
    const heldAnswer = await emailAgain(testApp, auth, held.reference);
    expectError(heldAnswer, 409, 'TICKET_NOT_AVAILABLE');
    expect(heldAnswer.body.error.details).toEqual({ status: 'held' });

    expect((await pay(testApp, auth, held.reference, declined)).status).toBe(201);
    clock.advance({ minutes: 6 });
    const failed = await emailAgain(testApp, auth, held.reference);
    expect(failed.body.error.details).toEqual({ status: 'failed' });

    const abandoned = await expectHold(testApp, showtime.showtimeId, ['C4'], {
      authorization: auth,
    });
    clock.advance({ minutes: 6 });
    const abandonedAnswer = await emailAgain(testApp, auth, abandoned.reference);
    expect(abandonedAnswer.body.error.details).toEqual({ status: 'abandoned' });

    const early = await bookableShowtime(testApp, admin, { fixture: showtime, startTime: '15:00' });
    const refunded = await paidBooking(testApp, auth, early.showtimeId, ['C5'], {
      method: 'card',
      token: 'sim_card_slow',
    });
    await cancelShowtime(testApp, admin, early.showtimeId);
    clock.advance({ seconds: 11 });
    const refundedAnswer = await emailAgain(testApp, auth, refunded);
    expectError(refundedAnswer, 409, 'TICKET_NOT_AVAILABLE');
    expect(refundedAnswer.body.error.details).toEqual({ status: 'refunded' });

    const templates = (await readMessages(testApp.knex)).map((message) => message.template);
    expect(templates.filter((template) => template.startsWith('booking.tickets'))).toEqual([]);
  });

  it('sends a completed booking again', async () => {
    const { customer, bookingId, reference } = await confirmed(['C6']);
    clock.set(new Date('2026-10-11T21:30:00+03:00'));
    // An access token lasts minutes: sign in again at the new time.
    const later = await signInCustomer(testApp, customer.email, customer.password);
    expect((await emailAgain(testApp, later.authorization, reference)).status).toBe(201);
    expect(await ticketMessages(bookingId)).toHaveLength(3);
  });

  it('refuses another customer, an unknown or malformed reference, no key and no token', async () => {
    const { customer, bookingId, reference } = await confirmed(['C7']);
    const other = await registerCustomer(testApp);
    expectError(await emailAgain(testApp, other.authorization, reference), 404, 'NOT_FOUND');
    expectError(await emailAgain(testApp, customer.authorization, 'MQ-2222ZZ'), 404, 'NOT_FOUND');
    expectError(
      await emailAgain(testApp, customer.authorization, 'MQ-1'),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await emailAgain(testApp, customer.authorization, reference, null),
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
    );
    expectError(await emailAgain(testApp, admin.authorization, reference), 401, 'UNAUTHENTICATED');
    expect(await ticketMessages(bookingId)).toHaveLength(2);
  });

  it('logs no personal data: no name, email, phone or ticket link', async () => {
    const { customer, reference } = await confirmed(['D2']);
    expect((await emailAgain(testApp, customer.authorization, reference)).status).toBe(201);
    await testApp.app.get(OutboxDrainService).whenIdle();

    const text = logs.text();
    expect(text).toContain('ticket-deliveries');
    for (const secret of [customer.email, FULL_NAME, '1012345678', 'ticket?token=', 'MQ1.']) {
      expect(text).not.toContain(secret);
    }
  });
});
