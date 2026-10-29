import type { Response } from 'supertest';
import { encodeCursor } from '../../../../src/common/pagination/cursor';
import { OutboxDrainService } from '../../../../src/modules/messaging/outbox-drain.service';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import { pay } from '../../../support/checkout';
import { TestClock } from '../../../support/clock';
import { registerCustomer, signInCustomer } from '../../../support/customer-auth';
import { HALLS } from '../../../support/halls';
import { bookableShowtime, expectHold, SMALL_LAYOUT } from '../../../support/holds';
import { RecordingEmailSender } from '../../../support/messaging/recording-email-sender';
import { listMyBookings, paidBooking } from '../../../support/my-bookings';
import { cancelShowtime, createSchedulingFixture } from '../../../support/showtimes';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { everyDay, setTheaterStatus } from '../../../support/theaters';
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

type Card = Record<string, unknown> & {
  reference: string;
  status: string;
  showtime: { startsAt: string; endsAt: string; cinemaDate: string };
};

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

const references = (response: Response): string[] =>
  (response.body.items as Card[]).map((card) => card.reference);

/**
 * My Bookings (PRD C10, design §7.4, §11): Upcoming and Past decided at read time from stored
 * timestamps against the `Clock`, with the cinema date on each card, cursor pages, a fixed query
 * count, settlement first, and nobody else's bookings. Real app and Postgres; only Resend is
 * replaced (`RecordingEmailSender`).
 */
describe('GET /me/bookings (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let showtime: BookableShowtimeFixture;
  let customer: CustomerSessionFixture;
  const clock = new TestClock(NOW);

  const list = (
    query: Record<string, string | number> = {},
    authorization = customer.authorization,
  ) => listMyBookings(testApp, authorization, query);

  /** Moves the clock, then signs in again: an access token lasts minutes, not days. */
  const travelTo = async (instant: Date): Promise<void> => {
    clock.set(instant);
    customer = await signInCustomer(testApp, customer.email, customer.password);
  };

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

  it('lists a confirmed booking in Upcoming and refunded and failed ones in Past; holds in neither', async () => {
    const confirmed = await paidBooking(testApp, customer.authorization, showtime.showtimeId, [
      'B2',
      'B3',
    ]);

    // Refunded: a slow payment whose showtime is cancelled meanwhile is refunded at settlement.
    const early = await bookableShowtime(testApp, admin, { fixture: showtime, startTime: '15:00' });
    const refunded = await paidBooking(
      testApp,
      customer.authorization,
      early.showtimeId,
      ['C1'],
      SLOW,
    );
    await cancelShowtime(testApp, admin, early.showtimeId);
    clock.advance({ seconds: 11 });
    await list();

    // Failed: a declined payment, then a new hold replaces it. Abandoned: replaced unpaid.
    const failed = await paidBooking(
      testApp,
      customer.authorization,
      showtime.showtimeId,
      ['C4'],
      DECLINED,
    );
    const abandoned = await expectHold(testApp, showtime.showtimeId, ['C5'], {
      authorization: customer.authorization,
    });
    const live = await expectHold(testApp, showtime.showtimeId, ['C6'], {
      authorization: customer.authorization,
    });

    const upcoming = await list();
    expect(upcoming.status).toBe(200);
    expect(upcoming.headers['cache-control']).toBe('private, no-store');
    expect(references(upcoming)).toEqual([confirmed]);
    expect(upcoming.body).toMatchObject({
      nextCursor: null,
      total: 1,
      tabCounts: { upcoming: 1, past: 2 },
    });
    const [card] = upcoming.body.items as Card[];
    expect(card).toMatchObject({
      status: 'confirmed',
      paymentStatus: 'paid',
      channel: 'online',
      seatLabels: ['B2', 'B3'],
      seatCount: 2,
      total: { amount: 38000, currency: 'EGP' },
      payment: { status: 'succeeded', method: 'card', card: { brand: 'visa', last4: '4242' } },
      refund: null,
      showtime: {
        id: showtime.showtimeId,
        cinemaDate: '2026-10-11',
        startsAt: '2026-10-11T19:30:00+03:00',
        movie: { id: showtime.movieId, ageRating: expect.any(String) },
        theater: {
          id: showtime.theaterId,
          address: expect.any(String),
          latitude: expect.any(Number),
        },
        hall: { id: showtime.hallId },
      },
    });
    expect(typeof card!.confirmedAt).toBe('string');
    expect(Object.keys(card!)).not.toEqual(expect.arrayContaining(['id', 'customerId', 'ticket']));

    const past = await list({ tab: 'past' });
    expect(past.status).toBe(200);
    // The most recent show first: 19:30 (failed), then the cancelled 15:00 one (refunded).
    expect(references(past)).toEqual([failed, refunded]);
    expect(past.body).toMatchObject({ total: 2, tabCounts: { upcoming: 1, past: 2 } });
    const [failedCard, refundedCard] = past.body.items as Card[];
    expect(failedCard).toMatchObject({
      status: 'failed',
      paymentStatus: 'declined',
      confirmedAt: null,
      refund: null,
    });
    expect(refundedCard).toMatchObject({
      status: 'refunded',
      paymentStatus: 'refunded',
      refund: { amount: { amount: 19000, currency: 'EGP' }, refundedAt: expect.any(String) },
    });

    for (const hidden of [abandoned.reference, live.reference]) {
      expect([...references(upcoming), ...references(past)]).not.toContain(hidden);
    }
  });

  it('moves a booking from Upcoming to Past at the showtime end exactly, with no write in between', async () => {
    const reference = await paidBooking(testApp, customer.authorization, showtime.showtimeId, [
      'B4',
    ]);
    const endsAt = new Date('2026-10-11T21:30:00+03:00');

    await travelTo(new Date(endsAt.getTime() - 1));
    const before = await list();
    expect(references(before)).toEqual([reference]);
    expect((before.body.items as Card[])[0]!.status).toBe('confirmed');
    expect(before.body.tabCounts).toEqual({ upcoming: 1, past: 0 });

    await travelTo(endsAt);
    expect(references(await list())).toEqual([]);
    const after = await list({ tab: 'past' });
    expect(references(after)).toEqual([reference]);
    expect(after.body.items[0]).toMatchObject({ status: 'completed', paymentStatus: 'paid' });
    expect(after.body.tabCounts).toEqual({ upcoming: 0, past: 1 });
  });

  it('labels a show after midnight with its cinema day and splits the tabs by the instant the show ends', async () => {
    const late = await createSchedulingFixture(testApp, admin, {
      days: everyDay('12:00', '03:00'),
    });
    const layout = await testApp
      .http()
      .put(`${HALLS}/${late.hallId}/layout`)
      .set('Authorization', admin.authorization)
      .send(SMALL_LAYOUT);
    expect(layout.status).toBe(200);
    await setTheaterStatus(testApp, admin.authorization, late.theaterId, 'active');
    const evening = await bookableShowtime(testApp, admin, { fixture: late, startTime: '22:00' });
    const night = await bookableShowtime(testApp, admin, { fixture: late, startTime: '00:30' });

    // Booked in the opposite order, so the list order is the shows', not the bookings'.
    const nightRef = await paidBooking(testApp, customer.authorization, night.showtimeId, ['B1']);
    const eveningRef = await paidBooking(testApp, customer.authorization, evening.showtimeId, [
      'B1',
    ]);

    const upcoming = await list();
    expect(references(upcoming)).toEqual([eveningRef, nightRef]);
    expect((upcoming.body.items as Card[]).map((card) => card.showtime)).toEqual([
      expect.objectContaining({ startsAt: '2026-10-11T22:00:00+03:00', cinemaDate: '2026-10-11' }),
      expect.objectContaining({ startsAt: '2026-10-12T00:30:00+03:00', cinemaDate: '2026-10-11' }),
    ]);

    // 00:45 on the next calendar day: the 22:00 show ended at 00:00, the 00:30 one runs to 02:30.
    await travelTo(new Date('2026-10-12T00:45:00+03:00'));
    const stillUpcoming = await list();
    expect(references(stillUpcoming)).toEqual([nightRef]);
    expect(stillUpcoming.body.items[0].status).toBe('confirmed');
    const past = await list({ tab: 'past' });
    expect(references(past)).toEqual([eveningRef]);
    expect(past.body.items[0].status).toBe('completed');
  });

  it('settles a slow payment whose result is due before listing it as confirmed', async () => {
    const reference = await paidBooking(
      testApp,
      customer.authorization,
      showtime.showtimeId,
      ['B5'],
      SLOW,
    );
    expect(references(await list())).toEqual([]);

    clock.advance({ seconds: 11 });
    const upcoming = await list();
    expect(references(upcoming)).toEqual([reference]);
    expect(upcoming.body.items[0]).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });
  });

  describe('pages', () => {
    let expected: string[];
    const showtimes: BookableShowtimeFixture[] = [];

    beforeAll(async () => {
      for (const cinemaDate of ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']) {
        showtimes.push(await bookableShowtime(testApp, admin, { fixture: showtime, cinemaDate }));
      }
    });

    beforeEach(async () => {
      // 12 bookings, three per show, made latest show first so ids run against the start order.
      const bookings: { reference: string; startsAt: number; order: number }[] = [];
      let order = 0;
      for (const target of [...showtimes].reverse()) {
        for (const seat of ['C2', 'C3', 'C7']) {
          bookings.push({
            reference: await paidBooking(testApp, customer.authorization, target.showtimeId, [
              seat,
            ]),
            startsAt: target.startsAt.getTime(),
            order: order++,
          });
        }
      }
      expected = bookings
        .sort((a, b) => a.startsAt - b.startsAt || a.order - b.order)
        .map((booking) => booking.reference);
    });

    const walk = async (tab: string): Promise<{ sizes: number[]; seen: string[] }> => {
      const sizes: number[] = [];
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const response: Response = await list({ tab, limit: 5, ...(cursor ? { cursor } : {}) });
        expect(response.status).toBe(200);
        expect(response.body.total).toBe(12);
        sizes.push(response.body.items.length);
        seen.push(...references(response));
        cursor = response.body.nextCursor as string | null;
      } while (cursor !== null);
      return { sizes, seen };
    };

    it('pages Upcoming soonest show first and Past most recent first, with no repeat or gap', async () => {
      expect(await walk('upcoming')).toEqual({ sizes: [5, 5, 2], seen: expected });

      await travelTo(new Date('2026-10-20T10:00:00+03:00'));
      expect(await walk('past')).toEqual({ sizes: [5, 5, 2], seen: [...expected].reverse() });
    });

    it('costs the same number of queries for a page of 1 and of 12', async () => {
      const count = async (limit: number): Promise<number> => {
        // The tickets emails of the payments drain in the background; count only this read.
        await testApp.app.get(OutboxDrainService).whenIdle();
        let queries = 0;
        const listener = (): void => {
          queries += 1;
        };
        testApp.knex.on('query', listener);
        try {
          const response = await list({ limit });
          expect(response.body.items).toHaveLength(limit);
        } finally {
          testApp.knex.removeListener('query', listener);
        }
        return queries;
      };
      const single = await count(1);
      expect(await count(12)).toBe(single);
      expect(single).toBeLessThan(20);
    });

    it('refuses a tampered cursor, a cursor of another kind, an unknown tab and an unknown field', async () => {
      expectError(await list({ cursor: 'bm90LWEtY3Vyc29y' }), 400, 'VALIDATION_FAILED');
      expectError(
        await list({ cursor: encodeCursor({ sortKey: 'Zamalek', id: 3 }) }),
        400,
        'VALIDATION_FAILED',
      );
      expectError(
        await list({ cursor: encodeCursor({ sortKey: null, id: 3 }) }),
        400,
        'VALIDATION_FAILED',
      );
      expectError(await list({ tab: 'later' }), 400, 'VALIDATION_FAILED');
      expectError(await list({ status: 'confirmed' }), 400, 'VALIDATION_FAILED');
      expectError(await list({ limit: 101 }), 400, 'VALIDATION_FAILED');
    });
  });

  it("shows nobody else's bookings, and answers 401 without a customer token", async () => {
    await paidBooking(testApp, customer.authorization, showtime.showtimeId, ['B6']);
    const other = await registerCustomer(testApp);

    const theirs = await list({}, other.authorization);
    expect(theirs.status).toBe(200);
    expect(theirs.body).toEqual({
      items: [],
      nextCursor: null,
      total: 0,
      tabCounts: { upcoming: 0, past: 0 },
    });
    expectError(await listMyBookings(testApp, undefined), 401, 'UNAUTHENTICATED');
    expectError(await listMyBookings(testApp, admin.authorization), 401, 'UNAUTHENTICATED');
  });

  it('lists a held booking claimed after sign-in only once it is paid', async () => {
    const guest = await expectHold(testApp, showtime.showtimeId, ['D2']);
    const claimed = await testApp
      .http()
      .post(`/api/v1/holds/${guest.reference}/claims`)
      .set('Authorization', customer.authorization)
      .set('X-Hold-Token', guest.holdCode!)
      .set('Idempotency-Key', `claim-${guest.reference}`)
      .send();
    expect(claimed.status).toBe(201);
    expect(references(await list())).toEqual([]);

    expect((await pay(testApp, customer.authorization, guest.reference)).status).toBe(201);
    expect(references(await list())).toEqual([guest.reference]);
  });
});
