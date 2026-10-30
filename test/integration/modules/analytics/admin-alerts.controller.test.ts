import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import { counterSale } from '../../../support/box-office';
import { customerHold, pay } from '../../../support/checkout';
import { TestClock } from '../../../support/clock';
import { registerCustomer } from '../../../support/customer-auth';
import { createHall } from '../../../support/halls';
import { bookableShowtime } from '../../../support/holds';
import { RecordingEmailSender } from '../../../support/messaging/recording-email-sender';
import { listAlerts, markAlertsRead } from '../../../support/overview-alerts';
import { cancelShowtime, scheduleShowtime } from '../../../support/showtimes';
import { signInStaff, staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { BookableShowtimeFixture, StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(300_000);

/** Saturday 10 October 2026, 10:00 Cairo time: cinema day 2026-10-10. */
const NOW = new Date('2026-10-10T10:00:00+03:00');
/** 19:31: the 19:30 show has started, the 22:00 one has not. */
const AFTER_FIRST_SHOW = new Date('2026-10-10T19:31:00+03:00');

interface Alert {
  key: string;
  kind: string;
  cinemaDate: string;
  title: string;
  read: boolean;
  readAt: string | null;
  failedPayments: { count: number } | null;
  lowSales: {
    showtimeId: number;
    ticketsSold: number;
    seatCapacity: number;
    soldShare: number;
  } | null;
  hallGap: { hall: { id: number }; theater: { id: number } } | null;
}

const keysOf = (response: Response): string[] =>
  (response.body.items as Alert[]).map((alert) => alert.key);

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

/**
 * The bell (design §13.3 "Alerts"; PRD A1 "Needs attention", "Notifications panel"). Real app and
 * Postgres; only Resend is replaced. One published theater, open 12:00–01:00 every day but closed
 * on Tuesday 13 October (a special date), with one active hall (31 seats) and a draft hall;
 * showtimes today at 19:30 and 22:00. So the hall-gap alerts are the active hall on the 11th,
 * 12th, 14th, 15th and 16th: never the draft hall, never the closed day, never today.
 */
describe('Admin alerts (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let boxOffice: StaffSession;
  let first: BookableShowtimeFixture;
  let secondId: number;
  const clock = new TestClock(NOW);

  async function signInAgain(): Promise<void> {
    admin = await signInStaff(testApp, admin.email, admin.password);
    boxOffice = await signInStaff(testApp, boxOffice.email, boxOffice.password);
  }

  async function bell(session: StaffSession, query: Record<string, string | number> = {}) {
    const response = await listAlerts(testApp, session.authorization, { limit: 100, ...query });
    expect(response.status).toBe(200);
    return response;
  }

  /** A customer's online payment that fails: declined by the card, or closed at the wallet. */
  async function failedPayment(token: string): Promise<void> {
    const hold = await customerHold(testApp, first.showtimeId, ['D1']);
    const method = token.startsWith('sim_wallet') ? 'wallet' : 'card';
    const result = await pay(testApp, hold.customer.authorization, hold.reference, {
      method,
      token,
    });
    expect(result.body.payment?.status).toBe(method === 'wallet' ? 'cancelled' : 'declined');
    // Release the hold so the seat can be held again by the next one.
    await testApp
      .http()
      .delete(`/api/v1/holds/${hold.reference}`)
      .set('Authorization', hold.customer.authorization);
  }

  beforeAll(async () => {
    testApp = await createTestApp({
      clock,
      overrides: [{ provide: EmailSender, useValue: new RecordingEmailSender() }],
    });
    admin = await staffSession(testApp, 'admin');
    boxOffice = await staffSession(testApp, 'box_office');
    first = await bookableShowtime(testApp, admin, {
      cinemaDate: '2026-10-10',
      startTime: '19:30',
    });
    secondId = (await scheduleShowtime(testApp, admin, first, '2026-10-10', '22:00')).id;
    await createHall(testApp, admin.authorization, first.theaterId, 'Hall draft');
    const closed = await testApp
      .http()
      .post(`/api/v1/admin/theaters/${first.theaterId}/special-dates`)
      .set('Authorization', admin.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ cinemaDate: '2026-10-13', label: 'Maintenance', closed: true });
    expect(closed.status).toBe(201);
  });

  beforeEach(async () => {
    clock.set(NOW);
    await signInAgain();
    await testApp.knex.raw(
      'TRUNCATE staff_alert_reads, payments, seat_claims, booking_seats, bookings, hold_refusals, idempotency_keys, messages CASCADE',
    );
  });

  afterAll(async () => {
    await testApp.close();
  });

  /** The active hall's gaps: every open day of the 7 but today (it has showtimes) and the 13th. */
  const gapKeys = (): string[] =>
    ['11', '12', '14', '15', '16'].map((day) => `hall-gap:${first.hallId}:2026-10-${day}`);

  it('raises each condition once, with its stable key, the same for every staff member', async () => {
    await failedPayment('sim_card_declined');
    await failedPayment('sim_wallet_cancelled');
    const page = await bell(admin);
    const expected = [
      'failed-payments:2026-10-10:2',
      `low-sales:${first.showtimeId}`,
      `low-sales:${secondId}`,
      ...gapKeys(),
    ];
    expect(keysOf(page)).toEqual(expected);
    expect({ total: page.body.total, unread: page.body.unreadCount }).toEqual({
      total: 8,
      unread: 8,
    });
    expect(page.body.cinemaDate).toBe('2026-10-10');
    const [failed, low] = page.body.items as Alert[];
    expect(failed).toMatchObject({
      kind: 'failed_payments',
      cinemaDate: '2026-10-10',
      title: '2 online payments failed today',
      read: false,
      readAt: null,
      failedPayments: { count: 2 },
      lowSales: null,
      hallGap: null,
    });
    expect(low).toMatchObject({
      kind: 'low_sales',
      lowSales: { showtimeId: first.showtimeId, ticketsSold: 0, seatCapacity: 31, soldShare: 0 },
    });
    expect((page.body.items as Alert[])[3]).toMatchObject({
      kind: 'hall_gap',
      cinemaDate: '2026-10-11',
      hallGap: { hall: { id: first.hallId }, theater: { id: first.theaterId } },
    });

    // Asking again, or as the other staff member, names the same alerts the same way.
    expect(keysOf(await bell(admin))).toEqual(expected);
    expect(keysOf(await bell(boxOffice))).toEqual(expected);
  });

  it('keeps read state per staff member, and the unread count follows it', async () => {
    await failedPayment('sim_card_declined');
    const before = await bell(admin);
    expect(before.body.unreadCount).toBe(8);

    const marked = await markAlertsRead(testApp, admin.authorization, {
      keys: ['failed-payments:2026-10-10:1', `low-sales:${first.showtimeId}`],
    });
    expect(marked.status).toBe(200);
    expect(marked.body).toEqual({ markedCount: 2, unreadCount: 6, total: 8 });

    const after = await bell(admin);
    expect(after.body.unreadCount).toBe(6);
    // Unread first: the two read alerts move to the end, in their own order.
    expect(keysOf(after).slice(-2)).toEqual([
      'failed-payments:2026-10-10:1',
      `low-sales:${first.showtimeId}`,
    ]);
    const read = (after.body.items as Alert[]).find(
      (alert) => alert.key === 'failed-payments:2026-10-10:1',
    );
    expect(read).toMatchObject({ read: true, readAt: '2026-10-10T10:00:00+03:00' });

    // The box office member's badge is their own.
    expect((await bell(boxOffice)).body.unreadCount).toBe(8);

    // Marking again changes nothing and keeps the first time.
    clock.set(new Date('2026-10-10T10:05:00+03:00'));
    await signInAgain();
    const again = await markAlertsRead(testApp, admin.authorization, {
      keys: ['failed-payments:2026-10-10:1'],
    });
    expect(again.body).toEqual({ markedCount: 0, unreadCount: 6, total: 8 });
    const rows = await testApp
      .knex('staff_alert_reads')
      .select('alert_key', 'seen_at')
      .where({ staff_user_id: admin.staffUserId })
      .orderBy('alert_key');
    expect(rows.map((row: { alert_key: string }) => row.alert_key)).toEqual([
      'failed-payments:2026-10-10:1',
      `low-sales:${first.showtimeId}`,
    ]);
    expect((rows[0] as { seen_at: Date }).seen_at.toISOString()).toBe('2026-10-10T07:00:00.000Z');
  });

  it('shows a failed-payments alert unread again when another payment fails', async () => {
    await failedPayment('sim_card_declined');
    expect((await markAlertsRead(testApp, admin.authorization)).body).toEqual({
      markedCount: 8,
      unreadCount: 0,
      total: 8,
    });
    expect((await bell(admin)).body.unreadCount).toBe(0);

    await failedPayment('sim_card_declined');
    const page = await bell(admin);
    expect(page.body.unreadCount).toBe(1);
    expect(page.body.items[0]).toMatchObject({
      key: 'failed-payments:2026-10-10:2',
      read: false,
      title: '2 online payments failed today',
    });
    expect(keysOf(page)).not.toContain('failed-payments:2026-10-10:1');

    // A stale panel's key is not current any more, so it is ignored.
    expect(
      (
        await markAlertsRead(testApp, admin.authorization, {
          keys: ['failed-payments:2026-10-10:1'],
        })
      ).body,
    ).toEqual({ markedCount: 0, unreadCount: 1, total: 8 });
  });

  it("marks only the panel's keys when sent, every current alert when omitted", async () => {
    await failedPayment('sim_card_declined');
    const panel = keysOf(await bell(admin));
    // Another failure after the panel was drawn: its new key was never shown.
    await failedPayment('sim_card_declined');

    const shown = await markAlertsRead(testApp, admin.authorization, { keys: panel });
    expect(shown.body).toEqual({ markedCount: 7, unreadCount: 1, total: 8 });
    expect((await bell(admin)).body.items[0]).toMatchObject({
      key: 'failed-payments:2026-10-10:2',
      read: false,
    });

    // "Mark all as read" marks what is current now, the unseen key included.
    const all = await markAlertsRead(testApp, admin.authorization);
    expect(all.body).toEqual({ markedCount: 1, unreadCount: 0, total: 8 });
  });

  it('drops a low-sales alert once 35% is sold or the show starts, and a gap once filled', async () => {
    // 10 of 31 seats (32%) is still under 35%; 11 (35.5%) is not.
    await counterSale(testApp, admin.authorization, first.showtimeId, [
      'B1',
      'B2',
      'B3',
      'B4',
      'B5',
      'B6',
      'B7',
      'B8',
    ]);
    await counterSale(testApp, admin.authorization, first.showtimeId, ['C1', 'C2']);
    const ten = await bell(admin);
    expect((ten.body.items as Alert[])[0]).toMatchObject({
      key: `low-sales:${first.showtimeId}`,
      lowSales: { ticketsSold: 10, soldShare: 0.3226 },
      title: expect.stringMatching(/ 19:30 in .+ is 32% sold$/),
    });
    await counterSale(testApp, admin.authorization, first.showtimeId, ['C3']);
    expect(keysOf(await bell(admin))).not.toContain(`low-sales:${first.showtimeId}`);

    clock.set(AFTER_FIRST_SHOW);
    await signInAgain();
    const started = await bell(admin);
    expect(keysOf(started).filter((key) => key.startsWith('low-sales'))).toEqual([
      `low-sales:${secondId}`,
    ]);

    const filler = await scheduleShowtime(testApp, admin, first, '2026-10-12', '19:30');
    expect(keysOf(await bell(admin))).not.toContain(`hall-gap:${first.hallId}:2026-10-12`);

    // A cancelled showtime fills nothing: the gap is back (and the other tests keep their gaps).
    await cancelShowtime(testApp, admin, filler.id);
    expect(keysOf(await bell(admin))).toContain(`hall-gap:${first.hallId}:2026-10-12`);
  });

  it('pages over the current alerts with the counts of the whole list', async () => {
    await markAlertsRead(testApp, boxOffice.authorization, { keys: [gapKeys()[0]!] });
    const all = keysOf(await bell(boxOffice));
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Response = await listAlerts(testApp, boxOffice.authorization, {
        limit: 3,
        ...(cursor === null ? {} : { cursor }),
      });
      expect(page.status).toBe(200);
      expect({ total: page.body.total, unread: page.body.unreadCount }).toEqual({
        total: 7,
        unread: 6,
      });
      seen.push(...keysOf(page));
      cursor = page.body.nextCursor as string | null;
    } while (cursor !== null);
    expect(seen).toEqual(all);
    expect(all[all.length - 1]).toBe(gapKeys()[0]);
  });

  it('tidies away reads older than 30 days when marking', async () => {
    await testApp.knex('staff_alert_reads').insert({
      staff_user_id: admin.staffUserId,
      alert_key: 'hall-gap:1:2026-09-01',
      seen_at: new Date('2026-09-01T10:00:00+03:00'),
    });
    await markAlertsRead(testApp, admin.authorization, { keys: [gapKeys()[1]!] });
    const keys = await testApp
      .knex('staff_alert_reads')
      .where({ staff_user_id: admin.staffUserId })
      .pluck('alert_key');
    expect(keys).toEqual([gapKeys()[1]]);
  });

  it('refuses malformed keys and pages', async () => {
    for (const body of [
      { keys: [] },
      { keys: null },
      { keys: ['Not A Key'] },
      { keys: 'low-sales:1' },
      { keys: Array.from({ length: 201 }, (_, index) => `low-sales:${index + 1}`) },
      { other: true },
    ]) {
      expectError(
        await markAlertsRead(testApp, admin.authorization, body),
        400,
        'VALIDATION_FAILED',
      );
    }
    const pages: Record<string, string | number>[] = [
      { limit: 0 },
      { limit: 101 },
      { cursor: 'not a cursor' },
    ];
    for (const query of pages) {
      expectError(await listAlerts(testApp, admin.authorization, query), 400, 'VALIDATION_FAILED');
    }
  });

  it('is for both staff roles, never customers', async () => {
    expect((await listAlerts(testApp, boxOffice.authorization)).status).toBe(200);
    expect((await markAlertsRead(testApp, boxOffice.authorization)).status).toBe(200);
    const customer = await registerCustomer(testApp);
    expectError(await listAlerts(testApp, customer.authorization), 401, 'UNAUTHENTICATED');
    expectError(await markAlertsRead(testApp, customer.authorization), 401, 'UNAUTHENTICATED');
    expectError(await testApp.http().get('/api/v1/admin/alerts'), 401, 'UNAUTHENTICATED');
  });
});
