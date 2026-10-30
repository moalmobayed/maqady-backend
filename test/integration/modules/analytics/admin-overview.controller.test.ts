import type { Response } from 'supertest';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import { paidOnline, refundBooking } from '../../../support/admin-bookings';
import { counterSale } from '../../../support/box-office';
import { TestClock } from '../../../support/clock';
import { registerCustomer } from '../../../support/customer-auth';
import { bookableShowtime, expectHold } from '../../../support/holds';
import { RecordingEmailSender } from '../../../support/messaging/recording-email-sender';
import { bookableFixture, getOverview } from '../../../support/overview-alerts';
import { cancelShowtime } from '../../../support/showtimes';
import { signInStaff, staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { everyDay } from '../../../support/theaters';
import type {
  BookableShowtimeFixture,
  SchedulingFixture,
  StaffSession,
  TestApp,
} from '../../../support/types';

jest.setTimeout(300_000);

/** Thursday 1 October 2026, 10:00 Cairo time: when last week's and Monday's sales are made. */
const EARLY = new Date('2026-10-01T10:00:00+03:00');
/** Saturday 10 October 2026, 10:00 Cairo time: cinema day 2026-10-10. */
const NOW = new Date('2026-10-10T10:00:00+03:00');
/** 01:00 on the 11th is still cinema day 2026-10-10; 06:00 starts 2026-10-11 (design §8). */
const AFTER_MIDNIGHT = new Date('2026-10-11T01:00:00+03:00');
const NEXT_CINEMA_DAY = new Date('2026-10-11T06:00:00+03:00');

const money = (amount: number) => ({ amount, currency: 'EGP' });

interface Named {
  id: number;
  name: string;
}

interface Point {
  cinemaDate: string;
  revenue: { amount: number };
}

interface Cell {
  weekday: number;
  slot: string;
  showtimeCount: number;
}

/** The parts of `AdminOverview` these tests read. */
interface OverviewBody {
  period: unknown;
  comparison: unknown;
  theater: Named | null;
  cinemaDate: string;
  kpis: {
    revenue: { value: unknown };
    ticketsSold: { value: number };
  };
  byTheater: { theater: Named }[];
  byHall: unknown[] | null;
  paymentMethods: unknown[];
  topMovies: { movie: Named; revenue: unknown; ticketsSold: number }[];
  heatmap: Cell[];
  tonight: {
    cinemaDate: string;
    total: number;
    items: { showtimeId: number; ticketsSold: number; soldShare: number }[];
  };
  revenueTrend: {
    dateFrom: string;
    dateTo: string;
    totals: Point[];
    theaters: { theater: Named; points: Point[] }[];
  };
}

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

/**
 * The admin Overview (PRD A1, "Dashboard numbers"; design §11, §13.3). Real app and Postgres;
 * only Resend is replaced. The dataset is built once through the real routes; the expected
 * numbers below are worked out by hand in piastres.
 *
 * Prices (the fixture theaters' defaults): front row A 150, middle rows B and C 190, back row D
 * 230 EGP. Each hall is `SMALL_LAYOUT`: 31 seats on sale.
 *
 * Theater X (open 06:00–04:00), hall X1:
 * - S6 Sat 3 Oct 19:30: online Visa B4 (190).
 * - S1 Sat 10 Oct 19:30: online Visa B2 B3 (380), cash C1 (190), a guest hold A3 (never counts).
 * - S2 Sat 10 Oct 00:30, so Sunday 11 Oct by the calendar: online Visa D1 (230); cinema day 10 Oct.
 * - S4 Sun 11 Oct 06:30: online Visa A2 (150); cinema day 11 Oct.
 *
 * Theater Y (open 12:00–01:00), hall Y1:
 * - S7 Mon 5 Oct 19:30: card terminal D2 D3 (460).
 * - S3 Sat 10 Oct 19:30: Apple Pay B1 (190); online C2 C3 (380) refunded (drops out).
 * - S5 Sat 10 Oct 13:00: cancelled, no bookings (its seats are not on sale).
 */
describe('Admin overview (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let boxOffice: StaffSession;
  let fixtureX: SchedulingFixture;
  let s1: BookableShowtimeFixture;
  let s2: BookableShowtimeFixture;
  let s3: BookableShowtimeFixture;
  let theaterX: Named;
  let theaterY: Named;
  let hallX: Named;
  const clock = new TestClock(EARLY);

  async function signInAgain(): Promise<void> {
    admin = await signInStaff(testApp, admin.email, admin.password);
    boxOffice = await signInStaff(testApp, boxOffice.email, boxOffice.password);
  }

  async function named(table: string, id: number, column = 'name'): Promise<Named> {
    const row = await testApp
      .knex(table)
      .select<Record<string, string>[]>(column)
      .where({ id })
      .first();
    return { id, name: row![column]! };
  }

  async function overview(query: Record<string, string | number>): Promise<{ body: OverviewBody }> {
    const response = await getOverview(testApp, admin.authorization, query);
    expect({
      status: response.status,
      body: response.status === 200 ? 'ok' : response.body,
    }).toEqual({ status: 200, body: 'ok' });
    return { body: response.body as OverviewBody };
  }

  beforeAll(async () => {
    testApp = await createTestApp({
      clock,
      overrides: [{ provide: EmailSender, useValue: new RecordingEmailSender() }],
    });
    admin = await staffSession(testApp, 'admin', { fullName: 'Mona Saeed' });
    boxOffice = await staffSession(testApp, 'box_office', { fullName: 'Hany Adel' });

    // Last week and Monday, sold on the 1st.
    fixtureX = await bookableFixture(testApp, admin, everyDay('06:00', '04:00'));
    const s6 = await bookableShowtime(testApp, admin, {
      fixture: fixtureX,
      cinemaDate: '2026-10-03',
      startTime: '19:30',
    });
    const s7 = await bookableShowtime(testApp, admin, { cinemaDate: '2026-10-05' });
    await paidOnline(testApp, s6.showtimeId, ['B4']);
    await counterSale(testApp, boxOffice.authorization, s7.showtimeId, ['D2', 'D3'], {
      method: 'card_terminal',
      receiptReference: 'TRX-1001',
      customer: { kind: 'walk_in' },
    });

    // Today, sold on the 10th.
    clock.set(NOW);
    await signInAgain();
    s1 = await bookableShowtime(testApp, admin, {
      fixture: fixtureX,
      cinemaDate: '2026-10-10',
      startTime: '19:30',
    });
    s2 = await bookableShowtime(testApp, admin, {
      fixture: fixtureX,
      cinemaDate: '2026-10-10',
      startTime: '00:30',
    });
    const s4 = await bookableShowtime(testApp, admin, {
      fixture: fixtureX,
      cinemaDate: '2026-10-11',
      startTime: '06:30',
    });
    s3 = await bookableShowtime(testApp, admin, {
      fixture: s7,
      cinemaDate: '2026-10-10',
      startTime: '19:30',
    });
    const s5 = await bookableShowtime(testApp, admin, {
      fixture: s7,
      cinemaDate: '2026-10-10',
      startTime: '13:00',
    });
    await cancelShowtime(testApp, admin, s5.showtimeId);

    await paidOnline(testApp, s1.showtimeId, ['B2', 'B3']);
    await counterSale(testApp, boxOffice.authorization, s1.showtimeId, ['C1']);
    await expectHold(testApp, s1.showtimeId, ['A3']);
    await paidOnline(testApp, s2.showtimeId, ['D1']);
    await paidOnline(testApp, s4.showtimeId, ['A2']);
    await paidOnline(testApp, s3.showtimeId, ['B1'], {
      payment: { method: 'wallet', token: 'sim_wallet_apple_pay' },
    });
    const refunded = await paidOnline(testApp, s3.showtimeId, ['C2', 'C3']);
    expect((await refundBooking(testApp, admin.authorization, refunded.reference)).status).toBe(
      201,
    );

    theaterX = await named('theaters', fixtureX.theaterId);
    theaterY = await named('theaters', s7.theaterId);
    hallX = await named('halls', fixtureX.hallId);
  });

  beforeEach(async () => {
    clock.set(NOW);
    await signInAgain();
  });

  afterAll(async () => {
    await testApp.close();
  });

  describe('today, all theaters', () => {
    it('computes the KPI cards against the same weekday last week', async () => {
      const { body } = await overview({ period: 'today' });
      expect(body.period).toEqual({
        preset: 'today',
        dateFrom: '2026-10-10',
        dateTo: '2026-10-10',
        days: 1,
        from: '2026-10-10T06:00:00+03:00',
        to: '2026-10-11T06:00:00+03:00',
      });
      expect(body.comparison).toEqual({
        basis: 'same_weekday_last_week',
        dateFrom: '2026-10-03',
        dateTo: '2026-10-03',
        days: 1,
        from: '2026-10-03T06:00:00+03:00',
        to: '2026-10-04T06:00:00+03:00',
      });
      expect(body.theater).toBeNull();
      expect(body.cinemaDate).toBe('2026-10-10');
      // S1 380 + 190, S2 230, S3 190 (the refund drops out): 990 EGP, 5 tickets of 93 seats.
      expect(body.kpis).toEqual({
        revenue: { value: money(99000), previous: money(19000), change: 4.2105 },
        ticketsSold: { value: 5, previous: 1, change: 4 },
        occupancy: { value: 0.0538, previous: 0.0323, change: 0.6656 },
        averageTicket: { value: money(19800), previous: money(19000), change: 0.0421 },
        counterShare: { value: 0.1919, previous: 0, change: null },
      });
    });

    it('splits revenue by theater, payment method and movie', async () => {
      const { body } = await overview({ period: 'today' });
      expect(body.byTheater).toEqual([
        {
          theater: theaterX,
          revenue: money(80000),
          ticketsSold: 4,
          seatsOnSale: 62,
          occupancy: 0.0645,
          showtimeCount: 2,
          averageTicket: money(20000),
          online: money(61000),
          counter: money(19000),
          previousRevenue: money(19000),
          change: 3.2105,
        },
        {
          theater: theaterY,
          revenue: money(19000),
          ticketsSold: 1,
          seatsOnSale: 31,
          occupancy: 0.0323,
          showtimeCount: 1,
          averageTicket: money(19000),
          online: money(19000),
          counter: money(0),
          previousRevenue: money(0),
          change: null,
        },
      ]);
      expect(body.byHall).toBeNull();
      expect(body.paymentMethods).toEqual([
        { method: 'card', amount: money(61000), share: 0.6162 },
        { method: 'wallet', amount: money(19000), share: 0.1919 },
        { method: 'cash', amount: money(19000), share: 0.1919 },
        { method: 'card_terminal', amount: money(0), share: 0 },
      ]);
      expect(
        body.topMovies.map((row: { movie: Named; revenue: unknown; ticketsSold: number }) => ({
          movieId: row.movie.id,
          revenue: row.revenue,
          ticketsSold: row.ticketsSold,
        })),
      ).toEqual([
        { movieId: fixtureX.movieId, revenue: money(80000), ticketsSold: 4 },
        { movieId: s3.movieId, revenue: money(19000), ticketsSold: 1 },
      ]);
    });

    it('fills the heatmap by weekday and start-time slot, scheduled showtimes only', async () => {
      const { body } = await overview({ period: 'today' });
      expect(body.heatmap).toHaveLength(35);
      const cell = (weekday: number, slot: string) =>
        body.heatmap.find(
          (entry: { weekday: number; slot: string }) =>
            entry.weekday === weekday && entry.slot === slot,
        );
      // Saturday is ISO weekday 6. S1 and S3 at 19:30; S2 at 00:30; the cancelled S5 at 13:00.
      expect(cell(6, '18_21')).toEqual({
        weekday: 6,
        slot: '18_21',
        showtimeCount: 2,
        ticketsSold: 4,
        seatsOnSale: 62,
        occupancy: 0.0645,
      });
      expect(cell(6, 'after_midnight')).toEqual({
        weekday: 6,
        slot: 'after_midnight',
        showtimeCount: 1,
        ticketsSold: 1,
        seatsOnSale: 31,
        occupancy: 0.0323,
      });
      expect(cell(6, 'before_15')).toEqual({
        weekday: 6,
        slot: 'before_15',
        showtimeCount: 0,
        ticketsSold: 0,
        seatsOnSale: 0,
        occupancy: null,
      });
      const filled = body.heatmap.filter(
        (entry: { showtimeCount: number }) => entry.showtimeCount > 0,
      );
      expect(filled).toHaveLength(2);
    });

    it('lists Tonight soonest first and the 30-day trend per theater', async () => {
      const { body } = await overview({ period: 'today' });
      expect(body.tonight.cinemaDate).toBe('2026-10-10');
      expect(body.tonight.total).toBe(3);
      expect(
        body.tonight.items.map(
          (item: { showtimeId: number; ticketsSold: number; soldShare: number }) => [
            item.showtimeId,
            item.ticketsSold,
            item.soldShare,
          ],
        ),
      ).toEqual([
        [s1.showtimeId, 3, 0.0968],
        [s3.showtimeId, 1, 0.0323],
        [s2.showtimeId, 1, 0.0323],
      ]);
      expect(body.tonight.items[0]).toMatchObject({
        startsAt: '2026-10-10T19:30:00+03:00',
        cinemaDate: '2026-10-10',
        hasStarted: false,
        theater: theaterX,
        hall: hallX,
        seatCapacity: 31,
        revenue: money(57000),
      });

      const trend = body.revenueTrend;
      expect({ dateFrom: trend.dateFrom, dateTo: trend.dateTo, days: trend.totals.length }).toEqual(
        { dateFrom: '2026-09-11', dateTo: '2026-10-10', days: 30 },
      );
      const nonZero = (points: { cinemaDate: string; revenue: { amount: number } }[]) =>
        points
          .filter((point) => point.revenue.amount !== 0)
          .map((point) => [point.cinemaDate, point.revenue.amount]);
      expect(nonZero(trend.totals)).toEqual([
        ['2026-10-03', 19000],
        ['2026-10-05', 46000],
        ['2026-10-10', 99000],
      ]);
      const series = Object.fromEntries(
        trend.theaters.map((line) => [line.theater.id, nonZero(line.points)]),
      );
      expect(series).toEqual({
        [theaterX.id]: [
          ['2026-10-03', 19000],
          ['2026-10-10', 80000],
        ],
        [theaterY.id]: [
          ['2026-10-05', 46000],
          ['2026-10-10', 19000],
        ],
      });
    });
  });

  it('compares 7 days with the 7 before them', async () => {
    const { body } = await overview({ period: '7d' });
    expect(body.period).toMatchObject({
      preset: '7d',
      dateFrom: '2026-10-04',
      dateTo: '2026-10-10',
    });
    expect(body.comparison).toMatchObject({
      basis: 'previous_period',
      dateFrom: '2026-09-27',
      dateTo: '2026-10-03',
      days: 7,
    });
    // Today's 990 EGP plus Monday's 460 at the counter: 7 tickets of 124 seats.
    expect(body.kpis).toEqual({
      revenue: { value: money(145000), previous: money(19000), change: 6.6316 },
      ticketsSold: { value: 7, previous: 1, change: 6 },
      occupancy: { value: 0.0565, previous: 0.0323, change: 0.7492 },
      averageTicket: { value: money(20714), previous: money(19000), change: 0.0902 },
      counterShare: { value: 0.4483, previous: 0, change: null },
    });
    expect(body.paymentMethods[3]).toEqual({
      method: 'card_terminal',
      amount: money(46000),
      share: 0.3172,
    });
    // Monday is ISO weekday 1.
    expect(
      body.heatmap.find(
        (entry: { weekday: number; slot: string }) => entry.weekday === 1 && entry.slot === '18_21',
      ),
    ).toMatchObject({ showtimeCount: 1, ticketsSold: 2, seatsOnSale: 31, occupancy: 0.0645 });
  });

  it('scopes to one theater, with revenue by hall', async () => {
    const { body } = await overview({ period: 'today', theaterId: theaterX.id });
    expect(body.theater).toEqual(theaterX);
    expect(body.kpis.revenue).toEqual({
      value: money(80000),
      previous: money(19000),
      change: 3.2105,
    });
    expect(body.byTheater.map((row: { theater: Named }) => row.theater)).toEqual([theaterX]);
    expect(body.byHall).toEqual([
      {
        hall: hallX,
        revenue: money(80000),
        ticketsSold: 4,
        seatsOnSale: 62,
        occupancy: 0.0645,
        showtimeCount: 2,
      },
    ]);
    expect(body.tonight.items.map((item: { showtimeId: number }) => item.showtimeId)).toEqual([
      s1.showtimeId,
      s2.showtimeId,
    ]);
    expect(body.revenueTrend.theaters.map((line: { theater: Named }) => line.theater)).toEqual([
      theaterX,
    ]);
  });

  describe('ranges follow the cinema date', () => {
    it('counts an after-midnight show on the day before, and a 06:30 show on its own day', async () => {
      const sunday = await overview({ dateFrom: '2026-10-11', dateTo: '2026-10-11' });
      expect(sunday.body.period).toMatchObject({ preset: null, days: 1 });
      expect(sunday.body.kpis.revenue.value).toEqual(money(15000));
      expect(sunday.body.kpis.ticketsSold.value).toBe(1);
      expect(sunday.body.comparison).toMatchObject({
        basis: 'same_weekday_last_week',
        dateFrom: '2026-10-04',
      });
    });

    it('reads "today" as the cinema day: 01:00 is still yesterday, 06:00 is the next day', async () => {
      clock.set(AFTER_MIDNIGHT);
      await signInAgain();
      const late = await overview({ period: 'today' });
      expect(late.body.cinemaDate).toBe('2026-10-10');
      expect(late.body.period).toMatchObject({ dateFrom: '2026-10-10', dateTo: '2026-10-10' });
      expect(late.body.kpis.revenue.value).toEqual(money(99000));
      // Only S2 is still running; it started at 00:30.
      expect(late.body.tonight.items).toEqual([
        expect.objectContaining({ showtimeId: s2.showtimeId, hasStarted: true }),
      ]);

      clock.set(NEXT_CINEMA_DAY);
      await signInAgain();
      const morning = await overview({ period: 'today' });
      expect(morning.body.cinemaDate).toBe('2026-10-11');
      expect(morning.body.period).toMatchObject({ dateFrom: '2026-10-11', dateTo: '2026-10-11' });
      expect(morning.body.kpis.revenue.value).toEqual(money(15000));
    });
  });

  it('reads in a fixed number of queries, whatever the period', async () => {
    const countQueries = async (query: Record<string, string>) => {
      let count = 0;
      const listener = () => {
        count += 1;
      };
      testApp.knex.on('query', listener);
      try {
        await overview(query);
      } finally {
        testApp.knex.removeListener('query', listener);
      }
      return count;
    };
    expect(await countQueries({ period: 'today' })).toBe(await countQueries({ period: '30d' }));
  });

  it('refuses bad periods and an unknown theater', async () => {
    const queries: Record<string, string | number>[] = [
      { period: 'week' },
      { period: 'today', dateFrom: '2026-10-10' },
      { dateFrom: '2026-10-12', dateTo: '2026-10-11' },
      { dateFrom: '2025-01-01', dateTo: '2026-10-10' },
      { dateFrom: '2026-02-30' },
      { theaterId: 0 },
      { unknown: 'x' },
    ];
    for (const query of queries) {
      expectError(await getOverview(testApp, admin.authorization, query), 400, 'VALIDATION_FAILED');
    }
    expectError(
      await getOverview(testApp, admin.authorization, { theaterId: 999999 }),
      404,
      'NOT_FOUND',
    );
  });

  it('is for admins only', async () => {
    expectError(await getOverview(testApp, boxOffice.authorization), 403, 'FORBIDDEN');
    const customer = await registerCustomer(testApp);
    expectError(await getOverview(testApp, customer.authorization), 401, 'UNAUTHENTICATED');
    expectError(await testApp.http().get('/api/v1/admin/overview'), 401, 'UNAUTHENTICATED');
  });
});
