import { AppError } from '../../../../src/common/errors/app-error';
import { encodeCursor } from '../../../../src/common/pagination/cursor';
import type { PaymentsReportRepository } from '../../../../src/modules/analytics/payments-report.repository';
import { PaymentsReportService } from '../../../../src/modules/analytics/payments-report.service';
import type {
  OnlineCheckRow,
  PeriodAggregateRow,
  TransactionRow,
} from '../../../../src/modules/analytics/types';
import type { SettlementService } from '../../../../src/modules/bookings/settlement.service';
import type { PaymentProvider } from '../../../../src/modules/payments/payment-provider';
import type { StaffService } from '../../../../src/modules/staff/staff.service';
import { TestClock } from '../../../support/clock';

/** 01:30 Cairo time on Sunday 11 October 2026: still the cinema day of Saturday the 10th. */
const NOW = new Date('2026-10-11T01:30:00+03:00');
const money = (amount: number) => ({ amount, currency: 'EGP' });

function transactionRow(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: 418,
    booking_id: 100,
    kind: 'charge',
    purpose: 'sale',
    method: 'card',
    status: 'succeeded',
    amount: 38000,
    currency: 'EGP',
    refund_of_payment_id: null,
    provider_reference: 'sim.sim_card_visa.1.abc',
    card_brand: 'visa',
    card_last4: '4242',
    wallet_type: null,
    collected_by_staff_id: null,
    paid_out_at: null,
    paid_out_by_staff_id: null,
    created_at: new Date('2026-10-10T19:00:00+03:00'),
    completed_at: new Date('2026-10-10T19:00:00+03:00'),
    occurred_at: new Date('2026-10-11T05:59:00+03:00'),
    booking_reference: 'MQ-7K3P9Q',
    booking_channel: 'online',
    contact_name: 'Nadia Farouk',
    theater_id: 3,
    theater_name: 'Zamalek Cinema',
    refunded_amount: 0,
    pending_refund_amount: 0,
    ...overrides,
  };
}

function onlineRow(overrides: Partial<OnlineCheckRow> = {}): OnlineCheckRow {
  return {
    id: 1,
    kind: 'charge',
    status: 'succeeded',
    amount: 19000,
    currency: 'EGP',
    provider_reference: 'sim.sim_card_visa.1.abc',
    booking_reference: 'MQ-7K3P9Q',
    ...overrides,
  };
}

const aggregate = (overrides: Partial<PeriodAggregateRow>): PeriodAggregateRow => ({
  theater_id: 3,
  theater_name: 'Zamalek Cinema',
  kind: 'charge',
  method: 'card',
  succeeded_amount: 0,
  succeeded_count: 0,
  declined_count: 0,
  cancelled_count: 0,
  ...overrides,
});

describe('PaymentsReportService', () => {
  const calls: string[] = [];
  const logged = <T>(name: string, value: T) =>
    jest.fn((..._args: unknown[]) => {
      calls.push(name);
      return Promise.resolve(value);
    });
  let report: Record<
    | 'page'
    | 'count'
    | 'periodAggregates'
    | 'onlineRowsCompletedBetween'
    | 'balanceMismatches'
    | 'overRefunds',
    jest.Mock
  >;
  let settlement: { settleAllDue: jest.Mock };
  let provider: { retrieve: jest.Mock };
  let staff: { findByIds: jest.Mock };
  let service: PaymentsReportService;

  beforeEach(() => {
    calls.length = 0;
    report = {
      page: logged('page', [transactionRow()]),
      count: logged('count', 1),
      periodAggregates: logged('aggregates', []),
      onlineRowsCompletedBetween: logged('online', []),
      balanceMismatches: logged('balances', []),
      overRefunds: logged('over-refunds', []),
    };
    settlement = { settleAllDue: logged('settle', undefined) };
    provider = {
      retrieve: jest.fn(() => {
        calls.push('retrieve');
        return Promise.resolve({ status: 'succeeded' });
      }),
    };
    staff = {
      findByIds: logged(
        'staff',
        new Map([
          [4, { id: 4, fullName: 'Hany Adel' }],
          [1, { id: 1, fullName: 'Mona Saeed' }],
        ]),
      ),
    };
    service = new PaymentsReportService(
      report as unknown as PaymentsReportRepository,
      settlement as unknown as SettlementService,
      provider as unknown as PaymentProvider,
      staff as unknown as StaffService,
      new TestClock(NOW),
    );
  });

  describe('transactions', () => {
    it('settles due payments, then reads the page, the total and the names, in that order', async () => {
      report.page = logged('page', [
        transactionRow({
          id: 420,
          kind: 'refund',
          purpose: 'cancellation',
          method: 'cash',
          status: 'succeeded',
          amount: 15000,
          refund_of_payment_id: 419,
          provider_reference: null,
          card_brand: null,
          card_last4: null,
          paid_out_at: new Date('2026-10-11T05:59:00+03:00'),
          paid_out_by_staff_id: 1,
        }),
        transactionRow({
          id: 419,
          method: 'card_terminal',
          provider_reference: 'TRX-77',
          card_brand: null,
          card_last4: null,
          collected_by_staff_id: 4,
          refunded_amount: 15000,
          amount: 15000,
        }),
      ]);
      const page = await service.transactions({ kind: 'charge' }, { limit: 1 });

      expect(calls).toEqual(['settle', 'page', 'count', 'staff']);
      expect(report.page).toHaveBeenCalledWith({ kind: 'charge' }, { after: null, limit: 1 });
      expect(staff.findByIds).toHaveBeenCalledWith([1]);
      expect(page.total).toBe(1);
      expect(page.nextCursor).toBe(encodeCursor({ sortKey: '2026-10-11T02:59:00.000Z', id: 420 }));
      expect(page.items).toEqual([
        expect.objectContaining({
          id: 420,
          kind: 'refund',
          channel: 'counter',
          status: 'succeeded',
          amount: money(-15000),
          refundedAmount: null,
          pendingRefundAmount: null,
          receiptReference: null,
          providerReference: null,
          paidOutBy: { id: 1, fullName: 'Mona Saeed' },
          cinemaDate: '2026-10-10',
          actions: { markPaidOut: false },
        }),
      ]);
    });

    it('maps a charge: its receipt or provider reference by rail, its refunds and the staff', async () => {
      report.page = logged('page', [
        transactionRow({
          method: 'card_terminal',
          provider_reference: 'TRX-77',
          card_brand: null,
          card_last4: null,
          collected_by_staff_id: 4,
          refunded_amount: 15000,
          pending_refund_amount: 0,
          amount: 15000,
        }),
        transactionRow({ id: 417, refunded_amount: 4000, pending_refund_amount: 2000 }),
      ]);
      const page = await service.transactions({}, {});
      expect(page.items[0]).toMatchObject({
        status: 'refunded',
        amount: money(15000),
        receiptReference: 'TRX-77',
        providerReference: null,
        collectedBy: { id: 4, fullName: 'Hany Adel' },
        card: null,
      });
      expect(page.items[1]).toMatchObject({
        status: 'succeeded',
        channel: 'online',
        receiptReference: null,
        providerReference: 'sim.sim_card_visa.1.abc',
        card: { brand: 'visa', last4: '4242' },
        refundedAmount: money(4000),
        pendingRefundAmount: money(2000),
        booking: { reference: 'MQ-7K3P9Q', channel: 'online', contactName: 'Nadia Farouk' },
        theater: { id: 3, name: 'Zamalek Cinema' },
      });
    });

    it('offers the payout of a pending counter refund only', async () => {
      report.page = logged('page', [
        transactionRow({
          kind: 'refund',
          method: 'cash',
          status: 'pending',
          completed_at: null,
          provider_reference: null,
        }),
      ]);
      const [item] = (await service.transactions({}, {})).items;
      expect(item).toMatchObject({ status: 'pending', actions: { markPaidOut: true } });
    });

    it('reads no names when the page names no staff member', async () => {
      await service.transactions({}, {});
      expect(calls).toEqual(['settle', 'page', 'count']);
    });

    it('refuses a reversed range and a cursor without a time before any read', async () => {
      await expect(
        service.transactions({ dateFrom: '2026-10-12', dateTo: '2026-10-11' }, {}),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { fields: [{ field: 'dateTo' }] },
      });
      await expect(
        service.transactions({}, { cursor: encodeCursor({ sortKey: null, id: 4 }) }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { fields: [{ field: 'cursor' }] },
      });
      await expect(
        service.transactions({}, { cursor: encodeCursor({ sortKey: 7, id: 4 }) }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(calls).toEqual([]);
    });
  });

  describe('periodOf', () => {
    it('defaults to the last 7 cinema days, today being the cinema day of 01:30', () => {
      expect(service.periodOf({})).toEqual({
        dateFrom: '2026-10-04',
        dateTo: '2026-10-10',
        from: new Date('2026-10-04T06:00:00+03:00'),
        to: new Date('2026-10-11T06:00:00+03:00'),
      });
    });

    it('fills the other end of a half-given period', () => {
      expect(service.periodOf({ dateTo: '2026-09-30' })).toMatchObject({
        dateFrom: '2026-09-24',
        dateTo: '2026-09-30',
      });
      expect(service.periodOf({ dateFrom: '2026-10-09' })).toMatchObject({
        dateFrom: '2026-10-09',
        dateTo: '2026-10-10',
      });
      expect(service.periodOf({ dateFrom: '2026-10-10', dateTo: '2026-10-10' })).toMatchObject({
        from: new Date('2026-10-10T06:00:00+03:00'),
        to: new Date('2026-10-11T06:00:00+03:00'),
      });
    });

    it('allows 366 days and refuses 367 or a reversed period', () => {
      expect(service.periodOf({ dateFrom: '2025-10-10', dateTo: '2026-10-10' }).dateFrom).toBe(
        '2025-10-10',
      );
      expect(() => service.periodOf({ dateFrom: '2025-10-09', dateTo: '2026-10-10' })).toThrow(
        expect.objectContaining({ code: 'VALIDATION_FAILED' }),
      );
      expect(() => service.periodOf({ dateFrom: '2026-10-10', dateTo: '2026-10-09' })).toThrow(
        expect.objectContaining({ code: 'VALIDATION_FAILED' }),
      );
    });
  });

  describe('summary', () => {
    it('refuses a bad period before settling anything', async () => {
      await expect(
        service.summary({ dateFrom: '2026-10-10', dateTo: '2026-10-09' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(calls).toEqual([]);
    });

    it('settles first, then reads the period, today and the checks', async () => {
      await service.summary({ dateFrom: '2026-10-01', dateTo: '2026-10-07' });
      expect(calls).toEqual([
        'settle',
        'aggregates',
        'aggregates',
        'online',
        'balances',
        'over-refunds',
      ]);
      const period = {
        from: new Date('2026-10-01T06:00:00+03:00'),
        to: new Date('2026-10-08T06:00:00+03:00'),
      };
      expect(report.periodAggregates).toHaveBeenNthCalledWith(1, period);
      // Failed today is today's cinema day, whatever the period.
      expect(report.periodAggregates).toHaveBeenNthCalledWith(2, {
        from: new Date('2026-10-10T06:00:00+03:00'),
        to: new Date('2026-10-11T06:00:00+03:00'),
      });
      expect(report.balanceMismatches).toHaveBeenCalledWith(period, 101);
      expect(report.overRefunds).toHaveBeenCalledWith(period, 101);
    });

    it('builds the four cards from the period and from today', async () => {
      report.periodAggregates = jest
        .fn()
        .mockResolvedValueOnce([
          aggregate({ method: 'card', succeeded_amount: 40000, succeeded_count: 2 }),
          aggregate({ method: 'cash', succeeded_amount: 10000, succeeded_count: 1 }),
          aggregate({ kind: 'refund', method: 'card', succeeded_amount: 5000, succeeded_count: 1 }),
        ])
        .mockResolvedValueOnce([aggregate({ declined_count: 2, cancelled_count: 1 })]);
      const summary = await service.summary({});
      expect(summary.cinemaDate).toBe('2026-10-10');
      expect(summary.kpis).toEqual({
        collectedOnline: money(35000),
        collectedAtCounters: money(10000),
        refunds: money(5000),
        refundRate: 0.1,
        failedToday: 3,
      });
      expect(summary.reconciliation.totals.net).toEqual(summary.totals.net);
      expect(summary.reconciliation.consistent).toBe(true);
    });

    it('compares each final online charge with the provider and lists what differs', async () => {
      report.onlineRowsCompletedBetween = logged('online', [
        onlineRow({ id: 1 }),
        onlineRow({ id: 2, provider_reference: 'sim.sim_card_slow_declined.1.abc' }),
        onlineRow({ id: 3, status: 'declined', provider_reference: 'sim.sim_card_declined.1.abc' }),
        onlineRow({ id: 4, provider_reference: 'gw_123' }),
        onlineRow({ id: 5, provider_reference: null }),
        onlineRow({ id: 6, kind: 'refund', provider_reference: 'simr.abc' }),
        onlineRow({ id: 7, kind: 'refund', provider_reference: null }),
      ]);
      provider.retrieve = jest.fn(({ providerReference }: { providerReference: string }) => {
        if (providerReference === 'gw_123') {
          return Promise.reject(new AppError('INTERNAL', 'Not a simulated charge reference.'));
        }
        return Promise.resolve({
          status: providerReference.includes('declined') ? 'declined' : 'succeeded',
        });
      });

      const { reconciliation } = await service.summary({});

      // Refunds are never retrieved; rows with no reference are never retrieved.
      expect((provider.retrieve.mock.calls as [unknown][]).map(([request]) => request)).toEqual([
        { providerReference: 'sim.sim_card_visa.1.abc' },
        { providerReference: 'sim.sim_card_slow_declined.1.abc' },
        { providerReference: 'sim.sim_card_declined.1.abc' },
        { providerReference: 'gw_123' },
      ]);
      expect(reconciliation.provider).toEqual({
        checkedCount: 4,
        ledgerSucceeded: money(57000),
        providerSucceeded: money(19000),
        matched: false,
      });
      expect(reconciliation.mismatches.map((entry) => [entry.check, entry.paymentId])).toEqual([
        ['provider_status', 2],
        ['provider_unknown', 4],
        ['missing_provider_reference', 5],
        ['missing_provider_reference', 7],
      ]);
      expect(reconciliation.mismatches[0]).toMatchObject({
        ledgerStatus: 'succeeded',
        providerStatus: 'declined',
        message: 'Payment 2 of MQ-7K3P9Q is succeeded in the ledger but declined at the provider.',
      });
      expect(reconciliation.consistent).toBe(false);
    });

    it('fails on a provider outage or an unexpected error instead of listing mismatches', async () => {
      report.onlineRowsCompletedBetween = logged('online', [onlineRow()]);
      provider.retrieve = jest.fn(() => Promise.reject(new AppError('SERVICE_UNAVAILABLE')));
      await expect(service.summary({})).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
      provider.retrieve = jest.fn(() => Promise.reject(new TypeError('boom')));
      await expect(service.summary({})).rejects.toThrow('boom');
    });

    it('describes the ledger checks in money, and truncates past 100 mismatches', async () => {
      report.balanceMismatches = logged(
        'balances',
        Array.from({ length: 101 }, (_, index) => ({
          booking_id: index + 1,
          reference: 'MQ-7K3P9Q',
          status: 'refunded',
          currency: 'EGP',
          expected: 0,
          actual: -2000,
        })),
      );
      report.overRefunds = logged('over-refunds', [
        { payment_id: 9, reference: 'MQ-ABCDEF', currency: 'EGP', amount: 38000, refunded: 40000 },
      ]);
      const { reconciliation } = await service.summary({});
      expect(reconciliation.truncated).toBe(true);
      expect(reconciliation.mismatches).toHaveLength(100);
      expect(reconciliation.mismatches[0]).toEqual({
        check: 'booking_balance',
        bookingReference: 'MQ-7K3P9Q',
        paymentId: null,
        expectedAmount: money(0),
        actualAmount: money(-2000),
        ledgerStatus: null,
        providerStatus: null,
        message:
          'Booking MQ-7K3P9Q is refunded and should hold EGP 0, but its succeeded charges minus refunds come to -EGP 20.',
      });

      report.balanceMismatches = logged('balances', []);
      const second = (await service.summary({})).reconciliation;
      expect(second.truncated).toBe(false);
      expect(second.mismatches).toEqual([
        expect.objectContaining({
          check: 'over_refunded',
          paymentId: 9,
          expectedAmount: money(38000),
          actualAmount: money(40000),
          message: 'Payment 9 of MQ-ABCDEF took EGP 380, but its refunds come to EGP 400.',
        }),
      ]);
    });
  });
});
