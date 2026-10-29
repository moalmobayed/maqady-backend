import type { Response } from 'supertest';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import {
  editBooking,
  paidOnline,
  payOutRefund,
  refundBooking,
} from '../../../support/admin-bookings';
import { counterSale } from '../../../support/box-office';
import { customerHold, pay } from '../../../support/checkout';
import { TestClock } from '../../../support/clock';
import { registerCustomer } from '../../../support/customer-auth';
import { bookableShowtime } from '../../../support/holds';
import { RecordingEmailSender } from '../../../support/messaging/recording-email-sender';
import { listTransactions, paymentsSummary } from '../../../support/payments-screen';
import { signInStaff, staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { BookableShowtimeFixture, StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(240_000);

/** Saturday 10 October 2026, 10:00 Cairo time: cinema day 2026-10-10; the shows are on the 11th. */
const NOW = new Date('2026-10-10T10:00:00+03:00');
/** 05:59 on the 11th is still cinema day 2026-10-10; 06:00 starts 2026-10-11 (design §8). */
const LAST_MINUTE_OF_THE_10TH = new Date('2026-10-11T05:59:00+03:00');
const FIRST_MINUTE_OF_THE_11TH = new Date('2026-10-11T06:00:00+03:00');

interface Row {
  id: number;
  kind: string;
  purpose: string;
  method: string;
  status: string;
  failureReason: string | null;
  ledgerStatus: string;
  amount: { amount: number; currency: string };
  refundOfPaymentId: number | null;
  refundedAmount: { amount: number } | null;
  pendingRefundAmount: { amount: number } | null;
  booking: { reference: string; channel: string; contactName: string | null };
  theater: { id: number; name: string };
  receiptReference: string | null;
  collectedBy: { id: number; fullName: string } | null;
  paidOutBy: { id: number; fullName: string } | null;
  paidOutAt: string | null;
  completedAt: string | null;
  occurredAt: string;
  cinemaDate: string;
  actions: { markPaidOut: boolean };
}

/** The parts of a summary the cinema-day test reads. */
interface DaySummary {
  totals: { gross: unknown; refunds: unknown };
  reconciliation: { byTheater: unknown[] };
}

interface Seeded {
  online: string;
  wallet: string;
  cash: string;
  terminal: string;
  declined: string;
  cancelled: string;
  slow: string;
  lateTerminal: string;
  cashRefundId: number;
}

const items = (response: Response): Row[] => response.body.items as Row[];
const money = (amount: number) => ({ amount, currency: 'EGP' });

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

/**
 * The Payments screen (design §11, §13.3; PRD A8): the transactions with their shown statuses,
 * the KPIs of a period in piastres by cinema day, and the reconciliation. Real app and Postgres;
 * only Resend is replaced.
 *
 * Prices (the fixture theater's defaults): front row A 150, middle rows B and C 190, back row D
 * 230 EGP.
 */
describe('Payments screen (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let boxOffice: StaffSession;
  let showtimeA: BookableShowtimeFixture;
  let showtimeB: BookableShowtimeFixture;
  let theaterA: { id: number; name: string };
  let theaterB: { id: number; name: string };
  const clock = new TestClock(NOW);
  const sender = new RecordingEmailSender();

  /** Signs both staff members in again after a jump of the clock (their tokens expire). */
  async function signInAgain(): Promise<void> {
    admin = await signInStaff(testApp, admin.email, admin.password);
    boxOffice = await signInStaff(testApp, boxOffice.email, boxOffice.password);
  }

  async function theaterOf(id: number): Promise<{ id: number; name: string }> {
    const row = await testApp
      .knex('theaters')
      .select<{ name: string }[]>('name')
      .where({ id })
      .first();
    return { id, name: row!.name };
  }

  beforeAll(async () => {
    testApp = await createTestApp({
      clock,
      overrides: [{ provide: EmailSender, useValue: sender }],
    });
    admin = await staffSession(testApp, 'admin', { fullName: 'Mona Saeed' });
    boxOffice = await staffSession(testApp, 'box_office', { fullName: 'Hany Adel' });
    showtimeA = await bookableShowtime(testApp, admin);
    showtimeB = await bookableShowtime(testApp, admin);
    theaterA = await theaterOf(showtimeA.theaterId);
    theaterB = await theaterOf(showtimeB.theaterId);
  });

  beforeEach(async () => {
    clock.set(NOW);
    await signInAgain();
    await testApp.knex.raw(
      'TRUNCATE booking_notes, payments, seat_claims, booking_seats, bookings, hold_refusals, audit_events, idempotency_keys, messages CASCADE',
    );
    sender.reset();
  });

  afterAll(async () => {
    await testApp.close();
  });

  /**
   * A mix of every payment state, through the real routes. On cinema day 2026-10-10:
   *
   * - 10:00 an online Visa sale on A (B2, B3: 380), an Apple Pay sale on B (C1: 190), a cash sale
   *   on B (A2: 150), a card-terminal sale on A (D1: 230, receipt TRX-77), a declined card on A
   *   (C5), a closed wallet on B (C6) and a slow card on A (C7: 190, processing);
   * - 10:01 the slow card is settled (succeeded);
   * - 10:02 the Visa sale is cancelled and refunded online (380), the cash sale cancelled with a
   *   pending cash refund (150), and the Apple Pay booking edited from C1 to A3, refunding the
   *   difference to the wallet (40);
   * - 05:59 on the 11th (still the 10th's cinema day) the cash refund is paid out;
   *
   * then at 06:00 on the 11th (cinema day 2026-10-11) a card-terminal sale on B (A4: 150, TRX-88).
   *
   * `checkpoints` run at 10:00 after the charges and at 10:02 after the refunds.
   */
  async function seedMix(
    checkpoints: {
      afterCharges?: (seeded: Partial<Seeded>) => Promise<void>;
      afterRefunds?: (seeded: Partial<Seeded>) => Promise<void>;
    } = {},
  ): Promise<Seeded> {
    const online = await paidOnline(testApp, showtimeA.showtimeId, ['B2', 'B3'], {
      fullName: 'Nadia Farouk',
    });
    const wallet = await paidOnline(testApp, showtimeB.showtimeId, ['C1'], {
      payment: { method: 'wallet', token: 'sim_wallet_apple_pay' },
    });
    const cash = await counterSale(testApp, boxOffice.authorization, showtimeB.showtimeId, ['A2']);
    const terminal = await counterSale(
      testApp,
      boxOffice.authorization,
      showtimeA.showtimeId,
      ['D1'],
      { method: 'card_terminal', receiptReference: 'TRX-77', customer: { kind: 'walk_in' } },
    );
    const declined = await customerHold(testApp, showtimeA.showtimeId, ['C5']);
    expect(
      (
        await pay(testApp, declined.customer.authorization, declined.reference, {
          method: 'card',
          token: 'sim_card_declined',
        })
      ).body.payment.status,
    ).toBe('declined');
    const cancelled = await customerHold(testApp, showtimeB.showtimeId, ['C6']);
    expect(
      (
        await pay(testApp, cancelled.customer.authorization, cancelled.reference, {
          method: 'wallet',
          token: 'sim_wallet_cancelled',
        })
      ).body.payment.status,
    ).toBe('cancelled');
    const slow = await customerHold(testApp, showtimeA.showtimeId, ['C7']);
    expect(
      (
        await pay(testApp, slow.customer.authorization, slow.reference, {
          method: 'card',
          token: 'sim_card_slow',
        })
      ).body.payment.status,
    ).toBe('processing');
    const seeded: Partial<Seeded> = {
      online: online.reference,
      wallet: wallet.reference,
      cash: cash.body.booking.reference as string,
      terminal: terminal.body.booking.reference as string,
      declined: declined.reference,
      cancelled: cancelled.reference,
      slow: slow.reference,
    };
    await checkpoints.afterCharges?.(seeded);

    clock.advance({ minutes: 1 });
    // Any admin read settles the due slow card.
    expect((await listTransactions(testApp, admin.authorization)).status).toBe(200);

    clock.advance({ minutes: 1 });
    expect((await refundBooking(testApp, admin.authorization, seeded.online!)).status).toBe(201);
    const cashRefund = await refundBooking(testApp, admin.authorization, seeded.cash!);
    expect(cashRefund.status).toBe(201);
    seeded.cashRefundId = cashRefund.body.refunds[0].id as number;
    const edit = await editBooking(testApp, admin.authorization, seeded.wallet!, {
      seats: ['A3'],
      reason: 'customer_request',
    });
    expect({ status: edit.status, difference: edit.body.difference }).toEqual({
      status: 201,
      difference: { direction: 'refund', amount: money(4000) },
    });
    await checkpoints.afterRefunds?.(seeded);

    clock.set(LAST_MINUTE_OF_THE_10TH);
    await signInAgain();
    expect((await payOutRefund(testApp, admin.authorization, seeded.cashRefundId)).status).toBe(
      201,
    );

    clock.set(FIRST_MINUTE_OF_THE_11TH);
    await signInAgain();
    const late = await counterSale(testApp, boxOffice.authorization, showtimeB.showtimeId, ['A4'], {
      method: 'card_terminal',
      receiptReference: 'TRX-88',
      customer: { kind: 'walk_in' },
    });
    seeded.lateTerminal = late.body.booking.reference as string;
    return seeded as Seeded;
  }

  async function allRows(query: Record<string, string | number> = {}): Promise<Row[]> {
    const response = await listTransactions(testApp, admin.authorization, { limit: 100, ...query });
    expect(response.status).toBe(200);
    return items(response);
  }

  const rowOf = (rows: Row[], reference: string, kind = 'charge', purpose?: string): Row => {
    const found = rows.filter(
      (row) =>
        row.booking.reference === reference &&
        row.kind === kind &&
        (purpose === undefined || row.purpose === purpose),
    );
    expect(found).toHaveLength(1);
    return found[0]!;
  };

  describe('GET /admin/payments', () => {
    it('shows every payment state with the status the screen names', async () => {
      const seeded = await seedMix({
        afterCharges: async (partial) => {
          const rows = await allRows();
          expect(rowOf(rows, partial.slow!)).toMatchObject({
            status: 'pending',
            ledgerStatus: 'processing',
            failureReason: null,
            completedAt: null,
          });
          expect(rowOf(rows, partial.declined!)).toMatchObject({
            status: 'failed',
            failureReason: 'declined',
            ledgerStatus: 'declined',
            amount: money(19000),
          });
          expect(rowOf(rows, partial.cancelled!)).toMatchObject({
            status: 'failed',
            failureReason: 'cancelled',
            ledgerStatus: 'cancelled',
            method: 'wallet',
          });
        },
        afterRefunds: async (partial) => {
          const rows = await allRows();
          expect(rowOf(rows, partial.slow!)).toMatchObject({
            status: 'succeeded',
            ledgerStatus: 'succeeded',
          });
          // A charge whose succeeded refunds reach its amount is Refunded; its refund is negative.
          const online = rowOf(rows, partial.online!);
          expect(online).toMatchObject({
            status: 'refunded',
            ledgerStatus: 'succeeded',
            channel: 'online',
            amount: money(38000),
            refundedAmount: money(38000),
            pendingRefundAmount: money(0),
            booking: { reference: partial.online, channel: 'online', contactName: 'Nadia Farouk' },
            theater: theaterA,
          });
          // The provider's own id is never published (U11).
          expect(online).not.toHaveProperty('providerReference');
          expect(rowOf(rows, partial.online!, 'refund')).toMatchObject({
            status: 'succeeded',
            purpose: 'cancellation',
            amount: money(-38000),
            refundOfPaymentId: online.id,
            refundedAmount: null,
            actions: { markPaidOut: false },
          });
          // A counter refund waits at the counter: Pending; its charge stays Succeeded until then.
          const cash = rowOf(rows, partial.cash!);
          expect(cash).toMatchObject({
            status: 'succeeded',
            channel: 'counter',
            refundedAmount: money(0),
            pendingRefundAmount: money(15000),
            collectedBy: { id: boxOffice.staffUserId, fullName: 'Hany Adel' },
            theater: theaterB,
          });
          expect(rowOf(rows, partial.cash!, 'refund')).toMatchObject({
            id: partial.cashRefundId,
            status: 'pending',
            ledgerStatus: 'pending',
            amount: money(-15000),
            completedAt: null,
            paidOutBy: null,
            actions: { markPaidOut: true },
          });
          // A partial refund (an edit's lower total) leaves the charge Succeeded.
          expect(rowOf(rows, partial.wallet!)).toMatchObject({
            status: 'succeeded',
            method: 'wallet',
            refundedAmount: money(4000),
          });
          expect(rowOf(rows, partial.wallet!, 'refund')).toMatchObject({
            status: 'succeeded',
            purpose: 'edit_difference',
            amount: money(-4000),
          });
          expect(rowOf(rows, partial.terminal!)).toMatchObject({
            status: 'succeeded',
            method: 'card_terminal',
            receiptReference: 'TRX-77',
          });
        },
      });

      const rows = await allRows();
      expect(rows).toHaveLength(11);
      expect(rowOf(rows, seeded.cash)).toMatchObject({
        status: 'refunded',
        refundedAmount: money(15000),
        pendingRefundAmount: money(0),
      });
      expect(rowOf(rows, seeded.cash, 'refund')).toMatchObject({
        status: 'succeeded',
        ledgerStatus: 'succeeded',
        paidOutAt: '2026-10-11T05:59:00+03:00',
        completedAt: '2026-10-11T05:59:00+03:00',
        occurredAt: '2026-10-11T05:59:00+03:00',
        cinemaDate: '2026-10-10',
        paidOutBy: { id: admin.staffUserId, fullName: 'Mona Saeed' },
        actions: { markPaidOut: false },
      });
      expect(rowOf(rows, seeded.lateTerminal)).toMatchObject({
        occurredAt: '2026-10-11T06:00:00+03:00',
        cinemaDate: '2026-10-11',
      });
    });

    it('filters by kind, method, channel, status, theater and cinema dates', async () => {
      const seeded = await seedMix();
      const ids = async (query: Record<string, string | number>) =>
        (await allRows(query))
          .map((row) => `${row.booking.reference}:${row.kind}:${row.purpose}`)
          .sort();
      const key = (reference: string, kind = 'charge', purpose = 'sale') =>
        `${reference}:${kind}:${purpose}`;

      expect(await ids({ kind: 'refund' })).toEqual(
        [
          key(seeded.online, 'refund', 'cancellation'),
          key(seeded.cash, 'refund', 'cancellation'),
          key(seeded.wallet, 'refund', 'edit_difference'),
        ].sort(),
      );
      expect(await ids({ method: 'card_terminal' })).toEqual(
        [key(seeded.terminal), key(seeded.lateTerminal)].sort(),
      );
      expect(await ids({ channel: 'counter' })).toEqual(
        [
          key(seeded.cash),
          key(seeded.cash, 'refund', 'cancellation'),
          key(seeded.terminal),
          key(seeded.lateTerminal),
        ].sort(),
      );
      expect(await ids({ status: 'failed' })).toEqual(
        [key(seeded.declined), key(seeded.cancelled)].sort(),
      );
      expect(await ids({ status: 'refunded' })).toEqual(
        [key(seeded.online), key(seeded.cash)].sort(),
      );
      expect(await ids({ status: 'pending' })).toEqual([]);
      expect(await ids({ status: 'succeeded' })).toEqual(
        [
          key(seeded.online, 'refund', 'cancellation'),
          key(seeded.cash, 'refund', 'cancellation'),
          key(seeded.wallet),
          key(seeded.wallet, 'refund', 'edit_difference'),
          key(seeded.terminal),
          key(seeded.slow),
          key(seeded.lateTerminal),
        ].sort(),
      );
      expect(await ids({ theaterId: theaterB.id, kind: 'charge' })).toEqual(
        [
          key(seeded.wallet),
          key(seeded.cash),
          key(seeded.cancelled),
          key(seeded.lateTerminal),
        ].sort(),
      );
      // The cinema day of the money's move: the 05:59 payout is the 10th's, the 06:00 sale the 11th's.
      expect(await ids({ dateFrom: '2026-10-11', dateTo: '2026-10-11' })).toEqual([
        key(seeded.lateTerminal),
      ]);
      expect(await ids({ dateTo: '2026-10-10' })).toHaveLength(10);
      expect(await ids({ dateFrom: '2026-10-12' })).toEqual([]);

      const page = await listTransactions(testApp, admin.authorization, {
        status: 'refunded',
        limit: 1,
      });
      expect({ total: page.body.total, count: items(page).length }).toEqual({ total: 2, count: 1 });
    });

    it('pages newest first by when the money moved, in a fixed number of queries', async () => {
      await seedMix();
      const all = await allRows();
      const order = all.map((row) => [Date.parse(row.occurredAt), row.id] as const);
      expect([...order].sort((a, b) => b[0] - a[0] || b[1] - a[1])).toEqual(order);
      expect(all[0]!.booking.channel).toBe('counter');

      const seen: number[] = [];
      let cursor: string | null = null;
      do {
        const page: Response = await listTransactions(testApp, admin.authorization, {
          limit: 5,
          ...(cursor === null ? {} : { cursor }),
        });
        expect(page.body.total).toBe(11);
        seen.push(...items(page).map((row) => row.id));
        cursor = page.body.nextCursor as string | null;
      } while (cursor !== null);
      expect(seen).toEqual(all.map((row) => row.id));

      const countQueries = async (query: Record<string, string | number>) => {
        let count = 0;
        const listener = () => {
          count += 1;
        };
        testApp.knex.on('query', listener);
        try {
          expect((await listTransactions(testApp, admin.authorization, query)).status).toBe(200);
        } finally {
          testApp.knex.removeListener('query', listener);
        }
        return count;
      };
      expect(await countQueries({ limit: 1 })).toBe(await countQueries({ limit: 100 }));
    });

    it('refuses bad filters', async () => {
      const queries: Record<string, string | number>[] = [
        { kind: 'payout' },
        { method: 'cheque' },
        { channel: 'phone' },
        { status: 'processing' },
        { theaterId: 0 },
        { dateFrom: '2026-02-30' },
        { dateFrom: '2026-10-12', dateTo: '2026-10-11' },
        { cursor: 'not a cursor' },
        { limit: 101 },
        { unknown: 'x' },
      ];
      for (const query of queries) {
        expectError(
          await listTransactions(testApp, admin.authorization, query),
          400,
          'VALIDATION_FAILED',
        );
      }
    });
  });

  describe('GET /admin/payments/summary', () => {
    it('computes the KPIs of a seeded mix of sales, refunds and counter sales in piastres', async () => {
      await seedMix({
        afterRefunds: async () => {
          // At 10:02 on the 10th: two charges failed today; the cash refund is not paid out yet.
          const early = await paymentsSummary(testApp, admin.authorization, {
            dateFrom: '2026-10-10',
            dateTo: '2026-10-10',
          });
          expect(early.body.kpis).toEqual({
            collectedOnline: money(38000 + 19000 + 19000 - 38000 - 4000),
            collectedAtCounters: money(15000 + 23000),
            refunds: money(38000 + 4000),
            refundRate: 0.3684,
            failedToday: 2,
          });
        },
      });
      const response = await paymentsSummary(testApp, admin.authorization, {
        dateFrom: '2026-10-10',
        dateTo: '2026-10-10',
      });
      expect(response.status).toBe(200);
      const body = response.body;
      // Charges: Visa 38000 + slow Visa 19000 + Apple Pay 19000 + cash 15000 + terminal 23000.
      // Refunds: Visa 38000 + wallet edit 4000 + cash 15000 (paid out at 05:59 on the 11th).
      expect(body.period).toEqual({
        dateFrom: '2026-10-10',
        dateTo: '2026-10-10',
        from: '2026-10-10T06:00:00+03:00',
        to: '2026-10-11T06:00:00+03:00',
      });
      expect(body.cinemaDate).toBe('2026-10-11');
      expect(body.totals).toEqual({
        gross: money(114000),
        chargeCount: 5,
        refunds: money(57000),
        refundCount: 3,
        net: money(57000),
      });
      expect(body.kpis).toEqual({
        collectedOnline: money(76000 - 42000),
        collectedAtCounters: money(38000 - 15000),
        refunds: money(57000),
        refundRate: 0.5,
        failedToday: 0,
      });
      expect(body.byChannel).toEqual([
        {
          channel: 'online',
          gross: money(76000),
          chargeCount: 3,
          refunds: money(42000),
          refundCount: 2,
          net: money(34000),
        },
        {
          channel: 'counter',
          gross: money(38000),
          chargeCount: 2,
          refunds: money(15000),
          refundCount: 1,
          net: money(23000),
        },
      ]);
      expect(body.byMethod).toEqual([
        {
          method: 'card',
          gross: money(57000),
          chargeCount: 2,
          refunds: money(38000),
          refundCount: 1,
          net: money(19000),
        },
        {
          method: 'wallet',
          gross: money(19000),
          chargeCount: 1,
          refunds: money(4000),
          refundCount: 1,
          net: money(15000),
        },
        {
          method: 'cash',
          gross: money(15000),
          chargeCount: 1,
          refunds: money(15000),
          refundCount: 1,
          net: money(0),
        },
        {
          method: 'card_terminal',
          gross: money(23000),
          chargeCount: 1,
          refunds: money(0),
          refundCount: 0,
          net: money(23000),
        },
      ]);
      expect(body.failed).toEqual({ count: 2, declinedCount: 1, cancelledCount: 1 });

      // The reconciliation by theater adds up to the KPI totals.
      const byName = <T extends { theater: { name: string } }>(rows: T[]): T[] =>
        [...rows].sort((a, b) => a.theater.name.localeCompare(b.theater.name));
      expect(body.reconciliation.byTheater).toEqual(
        byName([
          {
            theater: theaterA,
            online: money(57000),
            cash: money(0),
            cardTerminal: money(23000),
            refunds: money(38000),
            net: money(42000),
          },
          {
            theater: theaterB,
            online: money(19000),
            cash: money(15000),
            cardTerminal: money(0),
            refunds: money(19000),
            net: money(15000),
          },
        ]),
      );
      expect(body.reconciliation.totals).toEqual({
        online: money(76000),
        cash: money(15000),
        cardTerminal: money(23000),
        refunds: money(57000),
        net: money(57000),
      });
    });

    it('counts money on the cinema day it moved: 05:59 is the night before, 06:00 the new day', async () => {
      await seedMix();
      const day = async (date: string): Promise<DaySummary> =>
        (await paymentsSummary(testApp, admin.authorization, { dateFrom: date, dateTo: date }))
          .body as DaySummary;
      const eleventh = await day('2026-10-11');
      expect(eleventh.totals).toEqual({
        gross: money(15000),
        chargeCount: 1,
        refunds: money(0),
        refundCount: 0,
        net: money(15000),
      });
      expect(eleventh.reconciliation.byTheater).toEqual([
        {
          theater: theaterB,
          online: money(0),
          cash: money(0),
          cardTerminal: money(15000),
          refunds: money(0),
          net: money(15000),
        },
      ]);
      expect((await day('2026-10-10')).totals.refunds).toEqual(money(57000));
      const both = await paymentsSummary(testApp, admin.authorization, {
        dateFrom: '2026-10-10',
        dateTo: '2026-10-11',
      });
      expect(both.body.totals).toMatchObject({ gross: money(129000), net: money(72000) });
      expect((await day('2026-10-09')).totals.gross).toEqual(money(0));
    });

    it('defaults to the last 7 cinema days and refuses bad periods', async () => {
      clock.set(new Date('2026-10-17T05:30:00+03:00'));
      await signInAgain();
      const response = await paymentsSummary(testApp, admin.authorization);
      expect(response.status).toBe(200);
      expect(response.body.period).toEqual({
        dateFrom: '2026-10-10',
        dateTo: '2026-10-16',
        from: '2026-10-10T06:00:00+03:00',
        to: '2026-10-17T06:00:00+03:00',
      });
      expect(response.body.kpis).toEqual({
        collectedOnline: money(0),
        collectedAtCounters: money(0),
        refunds: money(0),
        refundRate: null,
        failedToday: 0,
      });
      expect(response.body.reconciliation).toMatchObject({
        byTheater: [],
        mismatches: [],
        consistent: true,
        truncated: false,
      });
      expect(
        (await paymentsSummary(testApp, admin.authorization, { dateTo: '2026-10-05' })).body.period,
      ).toMatchObject({ dateFrom: '2026-09-29', dateTo: '2026-10-05' });
      expect(
        (await paymentsSummary(testApp, admin.authorization, { dateFrom: '2026-10-15' })).body
          .period,
      ).toMatchObject({ dateFrom: '2026-10-15', dateTo: '2026-10-16' });
      expect(
        (
          await paymentsSummary(testApp, admin.authorization, {
            dateFrom: '2025-10-17',
            dateTo: '2026-10-17',
          })
        ).status,
      ).toBe(200);
      const refused: Record<string, string>[] = [
        { dateFrom: '2026-10-12', dateTo: '2026-10-11' },
        { dateFrom: '2025-10-16', dateTo: '2026-10-17' },
        { dateFrom: '2026-13-01' },
        { dateTo: 'yesterday' },
        { other: '1' },
      ];
      for (const query of refused) {
        expectError(
          await paymentsSummary(testApp, admin.authorization, query),
          400,
          'VALIDATION_FAILED',
        );
      }
    });

    it('reconciles with the provider when everything adds up', async () => {
      await seedMix();
      const body = (
        await paymentsSummary(testApp, admin.authorization, {
          dateFrom: '2026-10-10',
          dateTo: '2026-10-11',
        })
      ).body;
      // Visa, slow Visa, Apple Pay, the declined card and the closed wallet.
      expect(body.reconciliation.provider).toEqual({
        checkedCount: 5,
        ledgerSucceeded: money(76000),
        providerSucceeded: money(76000),
        matched: true,
      });
      expect(body.reconciliation).toMatchObject({
        mismatches: [],
        truncated: false,
        consistent: true,
      });
    });

    it('flags a deliberately inconsistent record', async () => {
      const seeded = await seedMix();
      const chargeOf = async (reference: string) =>
        (await testApp
          .knex('payments as p')
          .join('bookings as b', 'b.id', 'p.booking_id')
          .select<{ id: number; provider_reference: string | null }[]>(
            'p.id',
            'p.provider_reference',
          )
          .where({ 'b.reference': reference, 'p.kind': 'charge' })
          .first())!;
      // The card terminal's charge recorded 10 EGP short of its booking's total.
      const terminal = await chargeOf(seeded.terminal);
      await testApp.knex('payments').where({ id: terminal.id }).update({ amount: 22000 });
      // The provider's record of the slow card says it was declined after all.
      const slow = await chargeOf(seeded.slow);
      await testApp
        .knex('payments')
        .where({ id: slow.id })
        .update({
          provider_reference: slow.provider_reference!.replace(
            'sim_card_slow',
            'sim_card_slow_declined',
          ),
        });

      const body = (
        await paymentsSummary(testApp, admin.authorization, {
          dateFrom: '2026-10-10',
          dateTo: '2026-10-10',
        })
      ).body;
      expect(body.reconciliation.consistent).toBe(false);
      expect(body.reconciliation.provider).toEqual({
        checkedCount: 5,
        ledgerSucceeded: money(76000),
        providerSucceeded: money(57000),
        matched: false,
      });
      expect(body.reconciliation.mismatches).toEqual([
        {
          check: 'booking_balance',
          bookingReference: seeded.terminal,
          paymentId: null,
          expectedAmount: money(23000),
          actualAmount: money(22000),
          ledgerStatus: null,
          providerStatus: null,
          message: `Booking ${seeded.terminal} is confirmed and should hold EGP 230, but its succeeded charges minus refunds come to EGP 220.`,
        },
        {
          check: 'provider_status',
          bookingReference: seeded.slow,
          paymentId: slow.id,
          expectedAmount: null,
          actualAmount: null,
          ledgerStatus: 'succeeded',
          providerStatus: 'declined',
          message: `Payment ${slow.id} of ${seeded.slow} is succeeded in the ledger but declined at the provider.`,
        },
      ]);
    });

    it('flags a charge refunded beyond its amount, an unknown reference and a missing one', async () => {
      const seeded = await seedMix();
      const refund = (await testApp
        .knex('payments as p')
        .join('bookings as b', 'b.id', 'p.booking_id')
        .select<{ id: number; refund_of_payment_id: number }[]>('p.id', 'p.refund_of_payment_id')
        .where({ 'b.reference': seeded.online, 'p.kind': 'refund' })
        .first())!;
      await testApp.knex('payments').where({ id: refund.id }).update({ amount: 40000 });
      const wallet = (await testApp
        .knex('payments as p')
        .join('bookings as b', 'b.id', 'p.booking_id')
        .select<{ id: number }[]>('p.id')
        .where({ 'b.reference': seeded.wallet, 'p.kind': 'charge' })
        .first())!;
      await testApp
        .knex('payments')
        .where({ id: wallet.id })
        .update({ provider_reference: 'gw_123' });
      const declined = (await testApp
        .knex('payments as p')
        .join('bookings as b', 'b.id', 'p.booking_id')
        .select<{ id: number }[]>('p.id')
        .where({ 'b.reference': seeded.declined })
        .first())!;
      await testApp
        .knex('payments')
        .where({ id: declined.id })
        .update({ provider_reference: null });

      const mismatches = (
        await paymentsSummary(testApp, admin.authorization, { dateFrom: '2026-10-10' })
      ).body.reconciliation.mismatches as Record<string, unknown>[];
      expect(mismatches.map((entry) => [entry.check, entry.bookingReference])).toEqual([
        ['booking_balance', seeded.online],
        ['over_refunded', seeded.online],
        ['provider_unknown', seeded.wallet],
        ['missing_provider_reference', seeded.declined],
      ]);
      expect(mismatches[0]).toMatchObject({
        expectedAmount: money(0),
        actualAmount: money(-2000),
      });
      expect(mismatches[1]).toMatchObject({
        paymentId: refund.refund_of_payment_id,
        expectedAmount: money(38000),
        actualAmount: money(40000),
      });
    });
  });

  describe('access', () => {
    it('refuses box office and customer tokens on both routes', async () => {
      const customer = await registerCustomer(testApp);
      for (const path of ['/api/v1/admin/payments', '/api/v1/admin/payments/summary']) {
        expectError(
          await testApp.http().get(path).set('Authorization', boxOffice.authorization),
          403,
          'FORBIDDEN',
        );
        expectError(
          await testApp.http().get(path).set('Authorization', customer.authorization),
          401,
          'UNAUTHENTICATED',
        );
        expectError(await testApp.http().get(path), 401, 'UNAUTHENTICATED');
      }
    });
  });
});
