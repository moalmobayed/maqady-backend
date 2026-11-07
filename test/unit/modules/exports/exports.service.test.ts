import type { Readable } from 'node:stream';
import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { AuditEventInput } from '../../../../src/common/audit/types';
import type { StaffPrincipal } from '../../../../src/common/auth/types';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { AppError } from '../../../../src/common/errors/app-error';
import type { AdminCustomerResponseMapper } from '../../../../src/modules/admin-customers/admin-customer-response.mapper';
import type { AdminCustomersService } from '../../../../src/modules/admin-customers/admin-customers.service';
import type { OverviewService } from '../../../../src/modules/analytics/overview.service';
import type { PaymentsReportResponseMapper } from '../../../../src/modules/analytics/payments-report-response.mapper';
import type { PaymentsReportService } from '../../../../src/modules/analytics/payments-report.service';
import type { AdminBookingResponseMapper } from '../../../../src/modules/bookings/admin-booking-response.mapper';
import type { AdminBookingsService } from '../../../../src/modules/bookings/admin-bookings.service';
import { ExportOptions } from '../../../../src/modules/exports/export-options';
import { ExportsService } from '../../../../src/modules/exports/exports.service';
import { TestClock } from '../../../support/clock';

/** 01:30 Cairo time on the 11th: still cinema day 2026-10-10. */
const NOW = new Date('2026-10-11T01:30:00+03:00');
const ADMIN: StaffPrincipal = { kind: 'staff', id: 7, sessionId: 70, role: 'admin' };

async function textOf(stream: Readable): Promise<string> {
  let text = '';
  for await (const chunk of stream) text += String(chunk);
  return text;
}

async function* batchesOf<T>(...batches: T[][]): AsyncGenerator<T[]> {
  for (const batch of batches) yield await Promise.resolve(batch);
}

describe('ExportsService', () => {
  const events: string[] = [];
  const recorded: AuditEventInput[] = [];
  const audit = {
    record: jest.fn((event: AuditEventInput) => {
      events.push('audit');
      recorded.push(event);
      return Promise.resolve(1);
    }),
  };
  const transactions = {
    run: jest.fn(async <T>(fn: () => Promise<T>) => {
      events.push('transaction');
      return fn();
    }),
  };
  /** A list service's batches, noting when its rows are read. */
  function tracked<T>(...batches: T[][]): AsyncIterable<T[]> {
    return (async function* () {
      for (const batch of batches) {
        events.push('batch');
        yield await Promise.resolve(batch);
      }
    })();
  }
  const adminBookings = { exportBatches: jest.fn() };
  const adminCustomers = { exportBatches: jest.fn() };
  const paymentsReport = { transactionBatches: jest.fn() };
  const overviews = { read: jest.fn() };
  const bookingResponses = {
    listItem: jest.fn((item: { reference: string }) => ({
      reference: item.reference,
      contact: { name: '=cmd|calc', email: null, phone: '+201012345678' },
      showtime: { movie: { title: 'M' }, theater: { name: 'T' }, hall: { name: 'H' } },
      seatLabels: ['A1'],
      total: { amount: 19000, currency: 'EGP' },
      payment: null,
    })),
  };
  const customerResponses = {
    item: jest.fn((item: { id: number }) => ({
      id: item.id,
      stats: { spent: { amount: 0, currency: 'EGP' } },
    })),
  };
  const paymentResponses = {
    transaction: jest.fn((row: { id: number }) => ({
      id: row.id,
      amount: { amount: -4000, currency: 'EGP' },
      refundedAmount: null,
      pendingRefundAmount: null,
      booking: { reference: 'MQ-7K3P9Q' },
      theater: { id: 3, name: 'T' },
      card: null,
      collectedBy: null,
      paidOutBy: null,
    })),
  };
  const overviewResponses = { overview: jest.fn() };
  const options = new ExportOptions();

  const service = new ExportsService(
    adminBookings as unknown as AdminBookingsService,
    bookingResponses as unknown as AdminBookingResponseMapper,
    adminCustomers as unknown as AdminCustomersService,
    customerResponses as unknown as AdminCustomerResponseMapper,
    paymentsReport as unknown as PaymentsReportService,
    paymentResponses as unknown as PaymentsReportResponseMapper,
    overviews as unknown as OverviewService,
    overviewResponses,
    options,
    transactions as unknown as TransactionRepository,
    audit as unknown as AuditService,
    new TestClock(NOW),
  );

  beforeEach(() => {
    events.length = 0;
    recorded.length = 0;
  });

  it('reads 500 rows a batch by default', () => {
    expect(options.batchSize).toBe(500);
  });

  describe('bookings', () => {
    it('reads the first batch, records the download, then streams the rest', async () => {
      adminBookings.exportBatches.mockResolvedValue(
        tracked(
          [{ reference: 'MQ-AAAAAA' }, { reference: 'MQ-BBBBBB' }],
          [{ reference: 'MQ-CCCCCC' }],
        ),
      );
      const file = await service.bookings(ADMIN, {
        q: 'nadia@example.com',
        status: 'confirmed',
        dateFrom: '2026-10-01',
      });

      expect(adminBookings.exportBatches).toHaveBeenCalledWith(
        { q: 'nadia@example.com', status: 'confirmed', dateFrom: '2026-10-01' },
        500,
      );
      expect(events).toEqual(['batch', 'transaction', 'audit']);
      expect(recorded).toEqual([
        {
          actor: { kind: 'staff', id: 7 },
          action: 'export.downloaded',
          entity: { type: 'export', id: null },
          metadata: {
            dataset: 'bookings',
            search: true,
            status: 'confirmed',
            dateFrom: '2026-10-01',
          },
        },
      ]);
      expect(JSON.stringify(recorded)).not.toContain('nadia');
      expect(file.filename).toBe('maqady-bookings-2026-10-10.csv');

      const lines = (await textOf(file.stream)).split('\r\n');
      expect(events).toEqual(['batch', 'transaction', 'audit', 'batch']);
      expect(lines[0]?.startsWith('\uFEFFReference,Status,')).toBe(true);
      expect(lines.slice(1, 4).map((line) => line.split(',')[0])).toEqual([
        'MQ-AAAAAA',
        'MQ-BBBBBB',
        'MQ-CCCCCC',
      ]);
      // The contact cells are escaped: a formula name and an E.164 phone stay text.
      expect(lines[1]).toContain(",'=cmd|calc,,'+201012345678,");
    });

    it('records nothing when the list refuses the filters', async () => {
      adminBookings.exportBatches.mockRejectedValue(new AppError('VALIDATION_FAILED'));
      await expect(
        service.bookings(ADMIN, { dateFrom: '2026-10-10', dateTo: '2026-10-01' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('records nothing when the first batch cannot be read', async () => {
      adminBookings.exportBatches.mockResolvedValue(
        (async function* () {
          yield await Promise.reject(new AppError('SERVICE_UNAVAILABLE'));
        })(),
      );
      await expect(service.bookings(ADMIN, {})).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
      });
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('sends nothing and stops the stream when the record fails', async () => {
      adminBookings.exportBatches.mockResolvedValue(
        tracked([{ reference: 'MQ-AAAAAA' }], [{ reference: 'MQ-BBBBBB' }]),
      );
      audit.record.mockRejectedValueOnce(new AppError('INTERNAL'));
      await expect(service.bookings(ADMIN, {})).rejects.toMatchObject({ code: 'INTERNAL' });
      await new Promise((resolve) => setImmediate(resolve));
      // Only the first batch was read; no row left the server.
      expect(events).toEqual(['batch', 'transaction']);
    });
  });

  it('customers: the dataset, search as a flag and the status', async () => {
    adminCustomers.exportBatches.mockResolvedValue(batchesOf([{ id: 42 }]));
    const file = await service.customers(ADMIN, { q: '01012345678', status: 'blocked' });
    expect(adminCustomers.exportBatches).toHaveBeenCalledWith(
      { q: '01012345678', status: 'blocked' },
      500,
    );
    expect(recorded[0]?.metadata).toEqual({
      dataset: 'customers',
      search: true,
      status: 'blocked',
    });
    expect(JSON.stringify(recorded)).not.toContain('0101');
    expect(file.filename).toBe('maqady-customers-2026-10-10.csv');
    expect((await textOf(file.stream)).split('\r\n')[1]).toMatch(/^42,/);
  });

  it('payments: every filter given, a refund as a negative number, not escaped', async () => {
    paymentsReport.transactionBatches.mockResolvedValue(batchesOf([{ id: 12 }]));
    const file = await service.payments(ADMIN, {
      kind: 'refund',
      method: 'cash',
      theaterId: 3,
      dateFrom: '2026-10-01',
      dateTo: '2026-10-10',
    });
    expect(recorded[0]?.metadata).toEqual({
      dataset: 'payments',
      kind: 'refund',
      method: 'cash',
      theaterId: 3,
      dateFrom: '2026-10-01',
      dateTo: '2026-10-10',
    });
    expect((await textOf(file.stream)).split('\r\n')[1]).toMatch(/^12,,,,,,,,,,-40,EGP,/);
  });

  it('overview: the figures of the same query, recorded with the period', async () => {
    overviews.read.mockResolvedValue({ marker: true });
    overviewResponses.overview.mockReturnValue({
      period: { preset: 'today', dateFrom: '2026-10-10', dateTo: '2026-10-10', days: 1 },
      comparison: { basis: 'same_weekday_last_week', dateFrom: '2026-10-03', dateTo: '2026-10-03' },
      theater: null,
      serverTime: '2026-10-11T01:30:00+03:00',
      kpis: {
        revenue: { value: { amount: 0 }, previous: { amount: 0 }, change: null },
        ticketsSold: { value: 0, previous: 0, change: null },
        occupancy: { value: null, previous: null, change: null },
        averageTicket: { value: null, previous: null, change: null },
        counterShare: { value: null, previous: null, change: null },
      },
      byTheater: [],
      byHall: null,
      paymentMethods: [],
      topMovies: [],
      heatmap: [],
      revenueTrend: { totals: [], theaters: [] },
      tonight: { items: [] },
    });
    const file = await service.overview(ADMIN, { period: 'today' });
    expect(overviews.read).toHaveBeenCalledWith({ period: 'today' });
    expect(overviewResponses.overview).toHaveBeenCalledWith({ marker: true });
    expect(recorded[0]?.metadata).toEqual({ dataset: 'overview', period: 'today' });
    expect(file.filename).toBe('maqady-overview-2026-10-10.csv');
    expect(await textOf(file.stream)).toContain('\r\nkpis,,,All theaters,revenue,EGP,0,0,\r\n');
  });
});
