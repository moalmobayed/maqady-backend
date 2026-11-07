import type { Response } from 'supertest';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import { TestClock } from '../../../support/clock';
import { registerCustomer } from '../../../support/customer-auth';
import { bookableShowtime } from '../../../support/holds';
import { RecordingEmailSender } from '../../../support/messaging/recording-email-sender';
import { paidBooking } from '../../../support/my-bookings';
import { cancelShowtime } from '../../../support/showtimes';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { theaterBody } from '../../../support/theaters';
import type {
  BookableShowtimeFixture,
  CustomerSessionFixture,
  StaffSession,
  TestApp,
} from '../../../support/types';

jest.setTimeout(240_000);

const NOW = new Date('2026-10-10T10:00:00+03:00');
const SLOW = { method: 'card', token: 'sim_card_slow' };

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

/**
 * A booking's details on `GET /bookings/{ref}` as U12 extends them (PRD C11, design §11): the
 * payment table's seat lines by zone and price, the refund of a refunded booking, and the
 * theater's address and coordinates for "Directions". Real app and Postgres; only Resend is
 * replaced (`RecordingEmailSender`).
 */
describe('GET /bookings/{ref} details (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let showtime: BookableShowtimeFixture;
  let customer: CustomerSessionFixture;
  const clock = new TestClock(NOW);

  const details = (reference: string, authorization = customer.authorization) =>
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
    customer = await registerCustomer(testApp);
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('shows the seat lines by zone and price, front to back, and the theater with its location', async () => {
    // Middle seats picked first and out of seat order: the lines still read front to back.
    const reference = await paidBooking(testApp, customer.authorization, showtime.showtimeId, [
      'C2',
      'B5',
      'A3',
      'B2',
    ]);

    const response = await details(reference);
    expect(response.status).toBe(200);
    expect(response.body.seatLines).toEqual([
      {
        zone: 'front',
        labels: ['A3'],
        count: 1,
        unitPrice: { amount: 15000, currency: 'EGP' },
        amount: { amount: 15000, currency: 'EGP' },
      },
      {
        zone: 'middle',
        labels: ['B2', 'B5', 'C2'],
        count: 3,
        unitPrice: { amount: 19000, currency: 'EGP' },
        amount: { amount: 57000, currency: 'EGP' },
      },
    ]);
    expect(response.body.total).toEqual({ amount: 72000, currency: 'EGP' });
    expect(response.body.refund).toBeNull();
    const { name: _name, ...location } = theaterBody();
    expect(response.body.showtime.theater).toEqual({
      id: showtime.theaterId,
      name: expect.any(String),
      ...location,
    });
  });

  it("shows a refunded booking's refund: the full total and its date", async () => {
    const early = await bookableShowtime(testApp, admin, { fixture: showtime, startTime: '15:00' });
    const reference = await paidBooking(
      testApp,
      customer.authorization,
      early.showtimeId,
      ['A2', 'B2'],
      SLOW,
    );
    await cancelShowtime(testApp, admin, early.showtimeId);
    clock.advance({ seconds: 11 });

    const response = await details(reference);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'refunded',
      paymentStatus: 'refunded',
      total: { amount: 34000, currency: 'EGP' },
      ticket: null,
      refund: {
        amount: { amount: 34000, currency: 'EGP' },
        refundedAt: '2026-10-10T10:00:11+03:00',
      },
    });
    const lines = response.body.seatLines as { zone: string }[];
    expect(lines.map((line) => line.zone)).toEqual(['front', 'middle']);
  });

  it("answers 404 for another customer's booking", async () => {
    const reference = await paidBooking(testApp, customer.authorization, showtime.showtimeId, [
      'C3',
    ]);
    const other = await registerCustomer(testApp);
    expectError(await details(reference, other.authorization), 404, 'NOT_FOUND');
  });
});
