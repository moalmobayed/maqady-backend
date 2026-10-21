import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { TestClock } from '../../../support/clock';
import { DEFAULT_CUSTOMER_PASSWORD, registerCustomer } from '../../../support/customer-auth';
import { bookableShowtime, expectHold, seatMapClient } from '../../../support/holds';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { BookableShowtimeFixture, TestApp } from '../../../support/types';

jest.setTimeout(120_000);

const NOW = new Date('2026-10-10T10:00:00+03:00');

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

/**
 * Claiming a guest hold at sign-in (PRD Seats 3, C7; design §7.3), with tokens from the real
 * customer routes (`POST /auth/registrations`, `POST /auth/sessions`: the U9 follow-up).
 */
describe('Claiming a guest hold (integration)', () => {
  let testApp: TestApp;
  let showtime: BookableShowtimeFixture;
  const clock = new TestClock(NOW);

  const claim = (reference: string, authorization: string, holdCode?: string) => {
    let request = testApp
      .http()
      .post(`/api/v1/holds/${reference}/claims`)
      .set('Authorization', authorization)
      .set('Idempotency-Key', randomUUID());
    if (holdCode !== undefined) request = request.set('X-Hold-Token', holdCode);
    return request.send();
  };
  const register = async (): Promise<{
    authorization: string;
    customerId: number;
    email: string;
  }> => {
    const email = `claim-${randomUUID().slice(0, 8)}@test.maqady.local`;
    const response = await testApp
      .http()
      .post('/api/v1/auth/registrations')
      .send({ fullName: 'Layla Hassan', email, password: DEFAULT_CUSTOMER_PASSWORD });
    expect(response.status).toBe(201);
    return {
      authorization: `Bearer ${response.body.accessToken as string}`,
      customerId: response.body.customer.id as number,
      email,
    };
  };
  const signIn = async (email: string): Promise<string> => {
    const response = await testApp
      .http()
      .post('/api/v1/auth/sessions')
      .send({ email, password: DEFAULT_CUSTOMER_PASSWORD });
    expect(response.status).toBe(201);
    return `Bearer ${response.body.accessToken as string}`;
  };

  beforeAll(async () => {
    testApp = await createTestApp({ clock });
    const admin = await staffSession(testApp, 'admin');
    showtime = await bookableShowtime(testApp, admin);
  });

  beforeEach(async () => {
    clock.set(NOW);
    await testApp.knex.raw(
      'TRUNCATE seat_claims, booking_seats, bookings, hold_refusals, audit_events, idempotency_keys CASCADE',
    );
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('gives the hold to a customer who just registered, keeping its expiry; the code then stops working', async () => {
    const hold = await expectHold(testApp, showtime.showtimeId, ['C2', 'C3']);
    clock.set(new Date(NOW.getTime() + 2 * 60_000));
    const layla = await register();

    const claimed = await claim(hold.reference, layla.authorization, hold.holdCode!);
    expect(claimed.status).toBe(201);
    expect(claimed.body).toMatchObject({
      reference: hold.reference,
      owner: 'customer',
      status: 'held',
      holdExpiresAt: hold.holdExpiresAt,
      holdCode: null,
    });
    const row = await testApp.knex('bookings').where({ reference: hold.reference }).first();
    expect(row).toMatchObject({
      customer_id: layla.customerId,
      hold_token_hash: null,
      contact_name: 'Layla Hassan',
      contact_email: layla.email,
      contact_phone: null,
    });
    const audit = await testApp.knex('audit_events').where({ action: 'booking.claimed' });
    expect(audit).toEqual([
      expect.objectContaining({
        actor_kind: 'customer',
        actor_customer_id: layla.customerId,
        booking_id: row.id,
      }),
    ]);

    // The code is useless now; the owner reads the hold, and claiming again (a second tab) is fine.
    const asGuest = await testApp
      .http()
      .get(`/api/v1/bookings/${hold.reference}`)
      .set('X-Hold-Token', hold.holdCode!);
    expectError(asGuest, 404, 'NOT_FOUND');
    const asOwner = await testApp
      .http()
      .get(`/api/v1/bookings/${hold.reference}`)
      .set('Authorization', layla.authorization);
    expect(asOwner.body).toMatchObject({ owner: 'customer', status: 'held' });
    expect((await claim(hold.reference, layla.authorization)).status).toBe(400);
    expect((await claim(hold.reference, layla.authorization, hold.holdCode!)).status).toBe(201);

    // Another customer with the old code finds nothing.
    const other = await registerCustomer(testApp);
    expectError(await claim(hold.reference, other.authorization, hold.holdCode!), 404, 'NOT_FOUND');
  });

  it('claims after signing in, and releases the customer’s own earlier hold, announced on the seat map', async () => {
    const customer = await registerCustomer(testApp);
    const earlier = await expectHold(testApp, showtime.showtimeId, ['D5'], {
      authorization: customer.authorization,
    });
    const guestHold = await expectHold(testApp, showtime.showtimeId, ['D6']);
    const map = await seatMapClient(testApp);
    try {
      map.send('subscribe', { showtimeId: showtime.showtimeId });
      expect((await map.next()).event).toBe('snapshot');

      const authorization = await signIn(customer.email);
      const claimed = await claim(guestHold.reference, authorization, guestHold.holdCode!);
      expect(claimed.status).toBe(201);
      expect(await map.next()).toEqual({
        event: 'seat.released',
        data: { showtimeId: showtime.showtimeId, labels: ['D5'] },
      });
      const previous = await testApp
        .http()
        .get(`/api/v1/bookings/${earlier.reference}`)
        .set('Authorization', authorization);
      expect(previous.body.status).toBe('abandoned');
      const seats = await testApp.http().get(`/api/v1/showtimes/${showtime.showtimeId}/seats`);
      expect((seats.body.seats as { label: string }[]).map((seat) => seat.label)).toEqual(['D6']);
    } finally {
      await map.close();
    }
  });

  it('refuses a claim without the code, with a wrong one, and once the hold ran out', async () => {
    const customer = await registerCustomer(testApp);
    const hold = await expectHold(testApp, showtime.showtimeId, ['A7']);
    const missing = await claim(hold.reference, customer.authorization);
    expectError(missing, 400, 'VALIDATION_FAILED');
    expect(missing.body.error.details).toEqual({
      fields: [
        { field: 'X-Hold-Token', messages: ['X-Hold-Token is required: the guest hold code.'] },
      ],
    });
    expectError(
      await claim(hold.reference, customer.authorization, 'x'.repeat(43)),
      404,
      'NOT_FOUND',
    );
    expectError(await claim('MQ-222222', customer.authorization, hold.holdCode!), 404, 'NOT_FOUND');
    const guest = await testApp
      .http()
      .post(`/api/v1/holds/${hold.reference}/claims`)
      .set('Idempotency-Key', randomUUID())
      .set('X-Hold-Token', hold.holdCode!)
      .send();
    expectError(guest, 401, 'UNAUTHENTICATED');

    clock.set(new Date(NOW.getTime() + 5 * 60_000));
    const late = await registerCustomer(testApp);
    expectError(
      await claim(hold.reference, late.authorization, hold.holdCode!),
      409,
      'HOLD_EXPIRED',
    );
    expect(
      (await testApp.knex('bookings').where({ reference: hold.reference }).first()).customer_id,
    ).toBeNull();
  });
});
