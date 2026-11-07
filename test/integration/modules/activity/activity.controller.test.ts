import type { Response } from 'supertest';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import { paidOnline, refundBooking } from '../../../support/admin-bookings';
import { counterSale } from '../../../support/box-office';
import { TestClock } from '../../../support/clock';
import { allPages, exportCsv } from '../../../support/csv';
import { bookableShowtime } from '../../../support/holds';
import { RecordingEmailSender } from '../../../support/messaging/recording-email-sender';
import { signInStaff, staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { BookableShowtimeFixture, StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(240_000);

/** Saturday 10 October 2026, 10:00 Cairo time: cinema day 2026-10-10. */
const NOW = new Date('2026-10-10T10:00:00+03:00');
/** 05:59 on the 11th is still cinema day 2026-10-10; 06:00 starts 2026-10-11 (design §8). */
const LAST_MINUTE_OF_THE_10TH = new Date('2026-10-11T05:59:00+03:00');
const FIRST_MINUTE_OF_THE_11TH = new Date('2026-10-11T06:00:00+03:00');

const ACTIVITY = '/api/v1/admin/activity';

interface ActivityItem {
  id: number;
  occurredAt: string;
  cinemaDate: string;
  action: string;
  actor: {
    kind: string;
    staff: { id: number; fullName: string } | null;
    customerId: number | null;
  };
  entity: { type: string; id: number | null };
  booking: { reference: string } | null;
  changedFields: string[];
  metadata: Record<string, unknown>;
}

interface StoredEvent {
  id: number;
  actor_kind: string;
  actor_staff_user_id: number | null;
  entity_type: string;
  entity_id: number | null;
  action: string;
}

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

/**
 * The Activity log (design §13.5; PRD "Activity log"): real events written by real routes, read
 * back newest first through `GET /admin/activity` with its filters. Real app and Postgres; only
 * Resend is replaced.
 */
describe('Activity log (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let boxOffice: StaffSession;
  let showtime: BookableShowtimeFixture;
  const clock = new TestClock(NOW);
  const sender = new RecordingEmailSender();
  const personal: string[] = [];
  let online: { reference: string; bookingId: number; customerId: number };
  let cashReference: string;

  async function signInAgain(): Promise<void> {
    admin = await signInStaff(testApp, admin.email, admin.password);
    boxOffice = await signInStaff(testApp, boxOffice.email, boxOffice.password);
  }

  /** Every stored event, newest first, as the log must list them. */
  async function stored(where: Record<string, unknown> = {}): Promise<StoredEvent[]> {
    return testApp
      .knex('audit_events')
      .select<StoredEvent[]>(
        'id',
        'actor_kind',
        'actor_staff_user_id',
        'entity_type',
        'entity_id',
        'action',
      )
      .where(where)
      .orderBy([
        { column: 'occurred_at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ]);
  }

  const log = (query: Record<string, string | number> = {}, limit = 3) =>
    allPages<ActivityItem>(testApp, admin.authorization, ACTIVITY, query, limit);

  beforeAll(async () => {
    testApp = await createTestApp({
      clock,
      overrides: [{ provide: EmailSender, useValue: sender }],
    });
    admin = await staffSession(testApp, 'admin', { fullName: 'Mona Saeed' });
    boxOffice = await staffSession(testApp, 'box_office', { fullName: 'Hany Adel' });
    showtime = await bookableShowtime(testApp, admin);

    // Cinema day 2026-10-10: an online sale by a customer, a counter sale by the box office, a
    // refund by the admin, an export.
    online = await paidOnline(testApp, showtime.showtimeId, ['B2', 'B3'], {
      fullName: 'Nadia Farouk',
      phone: '01012345678',
    });
    const customer = await testApp
      .knex('customers')
      .select<{ email: string }[]>('email')
      .where({ id: online.customerId })
      .first();
    personal.push('Nadia', 'Farouk', customer!.email, '+201012345678', '1012345678');
    const cash = await counterSale(testApp, boxOffice.authorization, showtime.showtimeId, ['A2'], {
      method: 'cash',
      customer: { kind: 'contact', fullName: 'Walk In Karim', phone: '01098765432' },
    });
    personal.push('Karim', '1098765432');
    cashReference = cash.body.booking.reference as string;
    clock.advance({ minutes: 1 });
    expect((await refundBooking(testApp, admin.authorization, online.reference)).status).toBe(201);

    clock.set(LAST_MINUTE_OF_THE_10TH);
    await signInAgain();
    expect((await exportCsv(testApp, admin.authorization, 'bookings', { q: 'Nadia' })).status).toBe(
      200,
    );

    // Cinema day 2026-10-11.
    clock.set(FIRST_MINUTE_OF_THE_11TH);
    await signInAgain();
    expect((await exportCsv(testApp, admin.authorization, 'customers')).status).toBe(200);
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('lists every event newest first across pages, with the total', async () => {
    const first = await testApp
      .http()
      .get(ACTIVITY)
      .query({ limit: 3 })
      .set('Authorization', admin.authorization);
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('private, no-store');
    const expected = await stored();
    expect(expected.length).toBeGreaterThan(10);
    expect(first.body.total).toBe(expected.length);
    expect(first.body.items).toHaveLength(3);

    const items = await log();
    expect(items.map((item) => item.id)).toEqual(expected.map((event) => event.id));
    const times = items.map((item) => Date.parse(item.occurredAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('shows who did what to which item: staff by name, a customer by id, the booking reference', async () => {
    const items = await log({}, 100);
    const refund = items.find((item) => item.action === 'booking.refunded')!;
    expect(refund).toMatchObject({
      actor: {
        kind: 'staff',
        staff: { id: admin.staffUserId, fullName: 'Mona Saeed' },
        customerId: null,
      },
      entity: { type: 'booking', id: online.bookingId },
      booking: { reference: online.reference },
      occurredAt: '2026-10-10T10:01:00+03:00',
      cinemaDate: '2026-10-10',
    });
    const held = items.find(
      (item) => item.action === 'booking.held' && item.booking?.reference === online.reference,
    )!;
    expect(held.actor).toEqual({ kind: 'customer', staff: null, customerId: online.customerId });
    const payment = items.find(
      (item) => item.entity.type === 'payment' && item.booking?.reference === cashReference,
    )!;
    expect(payment.actor.staff).toEqual({ id: boxOffice.staffUserId, fullName: 'Hany Adel' });
    const exported = items.find((item) => item.action === 'export.downloaded')!;
    expect(exported).toMatchObject({
      entity: { type: 'export', id: null },
      booking: null,
      cinemaDate: '2026-10-11',
      metadata: { dataset: 'customers' },
    });
  });

  it('never shows personal data: no customer name, email or phone anywhere', async () => {
    const response = await testApp
      .http()
      .get(ACTIVITY)
      .query({ limit: 100 })
      .set('Authorization', admin.authorization);
    const body = JSON.stringify(response.body);
    for (const value of personal) expect(body).not.toContain(value);
    expect(body).toContain('"search":true');
  });

  it('filters by staff member', async () => {
    for (const member of [admin, boxOffice]) {
      const items = await log({ staffUserId: member.staffUserId });
      const expected = await stored({ actor_staff_user_id: member.staffUserId });
      expect(expected.length).toBeGreaterThan(0);
      expect(items.map((item) => item.id)).toEqual(expected.map((event) => event.id));
      for (const item of items) expect(item.actor.staff?.id).toBe(member.staffUserId);
    }
    expect(await log({ staffUserId: 999_999 })).toEqual([]);
  });

  it('filters by actor kind, item type, one item and action', async () => {
    for (const [query, where] of [
      [{ actorKind: 'customer' }, { actor_kind: 'customer' }],
      [{ actorKind: 'system' }, { actor_kind: 'system' }],
      [{ entityType: 'booking' }, { entity_type: 'booking' }],
      [{ entityType: 'export' }, { entity_type: 'export' }],
      [
        { entityType: 'booking', entityId: online.bookingId },
        { entity_type: 'booking', entity_id: online.bookingId },
      ],
      [{ action: 'booking.refunded' }, { action: 'booking.refunded' }],
      [
        { entityType: 'payment', actorKind: 'staff' },
        { entity_type: 'payment', actor_kind: 'staff' },
      ],
    ] as const) {
      const expected = await stored(where);
      expect(expected.length).toBeGreaterThan(0);
      expect((await log(query)).map((item) => item.id)).toEqual(expected.map((event) => event.id));
    }
  });

  it('filters by cinema dates, 06:00 to 06:00 Cairo time', async () => {
    const tenth = await log({ dateFrom: '2026-10-10', dateTo: '2026-10-10' }, 100);
    const eleventh = await log({ dateFrom: '2026-10-11' }, 100);
    expect(tenth.length).toBeGreaterThan(0);
    expect(new Set(tenth.map((item) => item.cinemaDate))).toEqual(new Set(['2026-10-10']));
    // The 05:59 export is still on the 10th; the 06:00 one is the 11th.
    expect(
      tenth.filter((item) => item.action === 'export.downloaded').map((item) => item.metadata),
    ).toEqual([{ dataset: 'bookings', search: true }]);
    expect(
      eleventh
        .filter((item) => item.action === 'export.downloaded')
        .map((item) => item.metadata.dataset),
    ).toEqual(['customers']);
    expect(new Set(eleventh.map((item) => item.cinemaDate))).toEqual(new Set(['2026-10-11']));
    expect(tenth.length + eleventh.length).toBe((await stored()).length);
    expect(await log({ dateTo: '2026-10-09' })).toEqual([]);
  });

  it('refuses malformed filters with VALIDATION_FAILED', async () => {
    for (const query of [
      { entityId: online.bookingId },
      { dateFrom: '2026-10-11', dateTo: '2026-10-10' },
      { entityType: 'Booking' },
      { actorKind: 'admin' },
      { action: 'refunded' },
      { cursor: 'not!a!cursor' },
      { limit: 101 },
      { q: 'Nadia' },
    ]) {
      expectError(
        await testApp.http().get(ACTIVITY).query(query).set('Authorization', admin.authorization),
        400,
        'VALIDATION_FAILED',
      );
    }
  });

  it('refuses a box office token (FORBIDDEN) and a customer token (UNAUTHENTICATED)', async () => {
    expectError(
      await testApp.http().get(ACTIVITY).set('Authorization', boxOffice.authorization),
      403,
      'FORBIDDEN',
    );
    const customer = await paidOnline(testApp, showtime.showtimeId, ['C1']);
    expectError(
      await testApp.http().get(ACTIVITY).set('Authorization', customer.authorization),
      401,
      'UNAUTHENTICATED',
    );
    expectError(await testApp.http().get(ACTIVITY), 401, 'UNAUTHENTICATED');
  });
});
