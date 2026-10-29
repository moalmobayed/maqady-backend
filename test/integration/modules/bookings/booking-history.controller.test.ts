import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { AuditService } from '../../../../src/common/audit/audit.service';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import { pay } from '../../../support/checkout';
import { TestClock } from '../../../support/clock';
import { registerCustomer } from '../../../support/customer-auth';
import { bookableShowtime, expectHold } from '../../../support/holds';
import { RecordingEmailSender } from '../../../support/messaging/recording-email-sender';
import { bookingHistory, emailAgain, paidBooking } from '../../../support/my-bookings';
import { cancelShowtime, SHOWTIMES } from '../../../support/showtimes';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type {
  BookableShowtimeFixture,
  CustomerSessionFixture,
  StaffSession,
  TestApp,
} from '../../../support/types';

jest.setTimeout(240_000);

const NOW = new Date('2026-10-10T10:00:00+03:00');
const DECLINED = { method: 'card', token: 'sim_card_declined' };
const SLOW = { method: 'card', token: 'sim_card_slow' };

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

const kinds = (response: Response): string[] =>
  (response.body.items as { kind: string }[]).map((event) => event.kind);

/**
 * A booking's History (PRD C11, design §13.5): the customer-visible subset of its real audit
 * events, oldest first, with friendly labels, and the moves of its showtime only while it held a
 * ticket. Real app and Postgres; only Resend is replaced.
 */
describe('GET /bookings/{ref}/history (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let showtime: BookableShowtimeFixture;
  let customer: CustomerSessionFixture;
  const clock = new TestClock(NOW);

  const history = (reference: string, query: Record<string, string | number> = {}) =>
    bookingHistory(testApp, customer.authorization, reference, query);
  const move = async (showtimeId: number, startTime: string): Promise<void> => {
    const response = await testApp
      .http()
      .patch(`${SHOWTIMES}/${showtimeId}`)
      .set('Authorization', admin.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ startTime });
    expect(response.status).toBe(200);
  };
  const tick = (): void => clock.advance({ seconds: 1 });

  beforeAll(async () => {
    testApp = await createTestApp({
      clock,
      overrides: [{ provide: EmailSender, useValue: new RecordingEmailSender() }],
    });
    admin = await staffSession(testApp, 'admin');
  });

  beforeEach(async () => {
    clock.set(NOW);
    await testApp.knex.raw(
      'TRUNCATE payments, seat_claims, booking_seats, bookings, hold_refusals, audit_events, idempotency_keys, messages CASCADE',
    );
    showtime = await bookableShowtime(testApp, admin);
    customer = await registerCustomer(testApp);
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('lists the held, paid and resent events in order, hiding the claim and the decline', async () => {
    const guest = await expectHold(testApp, showtime.showtimeId, ['B2', 'B3']);
    tick();
    const claimed = await testApp
      .http()
      .post(`/api/v1/holds/${guest.reference}/claims`)
      .set('Authorization', customer.authorization)
      .set('X-Hold-Token', guest.holdCode!)
      .set('Idempotency-Key', randomUUID())
      .send();
    expect(claimed.status).toBe(201);
    tick();
    expect(
      (await pay(testApp, customer.authorization, guest.reference, DECLINED)).body.payment.status,
    ).toBe('declined');
    tick();
    expect((await pay(testApp, customer.authorization, guest.reference)).status).toBe(201);
    tick();
    expect((await emailAgain(testApp, customer.authorization, guest.reference)).status).toBe(201);

    const response = await history(guest.reference);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toEqual({
      items: [
        { kind: 'seats_held', label: 'Seats held', occurredAt: '2026-10-10T10:00:00+03:00' },
        {
          kind: 'payment_received',
          label: 'Payment received',
          occurredAt: '2026-10-10T10:00:03+03:00',
        },
        {
          kind: 'tickets_resent',
          label: 'Tickets resent',
          occurredAt: '2026-10-10T10:00:04+03:00',
        },
      ],
      nextCursor: null,
      total: 3,
    });
  });

  it('adds a move of its showtime made while it held a ticket, not one made before or of another showtime', async () => {
    const other = await bookableShowtime(testApp, admin, { fixture: showtime, startTime: '13:00' });
    const hold = await expectHold(testApp, showtime.showtimeId, ['C2'], {
      authorization: customer.authorization,
    });
    tick();
    await move(showtime.showtimeId, '19:45'); // before the payment: no ticket yet
    tick();
    expect((await pay(testApp, customer.authorization, hold.reference)).status).toBe(201);
    tick();
    await move(other.showtimeId, '13:30'); // another showtime
    tick();
    await move(showtime.showtimeId, '20:00'); // while it holds a ticket

    expect(kinds(await history(hold.reference))).toEqual([
      'seats_held',
      'payment_received',
      'changed_by_cinema',
    ]);
    expect((await history(hold.reference)).body.items[2]).toEqual({
      kind: 'changed_by_cinema',
      label: 'Changed by the cinema',
      occurredAt: '2026-10-10T10:00:04+03:00',
    });
  });

  it('shows a refund after the payment received', async () => {
    const early = await bookableShowtime(testApp, admin, { fixture: showtime, startTime: '15:00' });
    const reference = await paidBooking(
      testApp,
      customer.authorization,
      early.showtimeId,
      ['C1'],
      SLOW,
    );
    tick();
    await cancelShowtime(testApp, admin, early.showtimeId);
    clock.advance({ seconds: 11 });

    const response = await history(reference);
    expect(kinds(response)).toEqual(['seats_held', 'payment_received', 'refunded']);
    expect(response.body.items[2].label).toBe('Refunded');
  });

  it('stops adding moves of its showtime once the booking is refunded', async () => {
    const hold = await expectHold(testApp, showtime.showtimeId, ['C5'], {
      authorization: customer.authorization,
    });
    expect((await pay(testApp, customer.authorization, hold.reference)).status).toBe(201);
    tick();
    await move(showtime.showtimeId, '19:45'); // while it holds a ticket
    tick();
    // Refunded the way U14's cancel and refund will store it: the row, then its audit event.
    const refundedAt = clock.now();
    const [row] = await testApp
      .knex('bookings')
      .where({ reference: hold.reference })
      .update({ status: 'refunded', refunded_at: refundedAt, updated_at: refundedAt })
      .returning<{ id: number }[]>('id');
    await testApp.app.get(AuditService).record({
      actor: { kind: 'staff', id: admin.staffUserId },
      action: 'booking.refunded',
      entity: { type: 'booking', id: row!.id },
      bookingId: row!.id,
    });
    tick();
    await move(showtime.showtimeId, '20:00'); // after the refund: no longer the customer's ticket

    const response = await history(hold.reference);
    expect(response.body).toEqual({
      items: [
        expect.objectContaining({ kind: 'seats_held' }),
        expect.objectContaining({ kind: 'payment_received' }),
        {
          kind: 'changed_by_cinema',
          label: 'Changed by the cinema',
          occurredAt: '2026-10-10T10:00:01+03:00',
        },
        { kind: 'refunded', label: 'Refunded', occurredAt: '2026-10-10T10:00:02+03:00' },
      ],
      nextCursor: null,
      total: 4,
    });
  });

  it('pages oldest first with limit=1, with no repeat or gap', async () => {
    const reference = await paidBooking(testApp, customer.authorization, showtime.showtimeId, [
      'C3',
    ]);
    for (let sent = 0; sent < 2; sent += 1) {
      tick();
      expect((await emailAgain(testApp, customer.authorization, reference)).status).toBe(201);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Response = await history(reference, { limit: 1, ...(cursor ? { cursor } : {}) });
      expect(page.status).toBe(200);
      expect(page.body.total).toBe(4);
      expect(page.body.items).toHaveLength(1);
      seen.push(...kinds(page));
      cursor = page.body.nextCursor as string | null;
    } while (cursor !== null);
    expect(seen).toEqual(['seats_held', 'payment_received', 'tickets_resent', 'tickets_resent']);
    expectError(await history(reference, { cursor: 'bm90LWEtY3Vyc29y' }), 400, 'VALIDATION_FAILED');
  });

  it("answers 404 for another customer's booking or an unknown one, and 401 without a customer token", async () => {
    const reference = await paidBooking(testApp, customer.authorization, showtime.showtimeId, [
      'C4',
    ]);
    const other = await registerCustomer(testApp);

    expectError(await bookingHistory(testApp, other.authorization, reference), 404, 'NOT_FOUND');
    expectError(await history('MQ-2222ZZ'), 404, 'NOT_FOUND');
    expectError(await history('MQ-1'), 400, 'VALIDATION_FAILED');
    expectError(await bookingHistory(testApp, undefined, reference), 401, 'UNAUTHENTICATED');
    expectError(
      await bookingHistory(testApp, admin.authorization, reference),
      401,
      'UNAUTHENTICATED',
    );
  });
});
