import { AppError } from '../../../../src/common/errors/app-error';
import type { OverviewRepository } from '../../../../src/modules/analytics/overview.repository';
import { OverviewService } from '../../../../src/modules/analytics/overview.service';
import { PaymentsReportService } from '../../../../src/modules/analytics/payments-report.service';
import type { PaymentsReportRepository } from '../../../../src/modules/analytics/payments-report.repository';
import type { ShowtimeAggregateRow, TonightRow } from '../../../../src/modules/analytics/types';
import type { SettlementService } from '../../../../src/modules/bookings/settlement.service';
import type { PaymentProvider } from '../../../../src/modules/payments/payment-provider';
import type { StaffService } from '../../../../src/modules/staff/staff.service';
import { TestClock } from '../../../support/clock';

/** 01:30 Cairo time on Sunday 11 October 2026: still the cinema day of Saturday the 10th. */
const NOW = new Date('2026-10-11T01:30:00+03:00');

function showtime(overrides: Partial<ShowtimeAggregateRow> = {}): ShowtimeAggregateRow {
  return {
    showtime_id: 1,
    theater_id: 3,
    hall_id: 30,
    movie_id: 300,
    cinema_date: '2026-10-10',
    starts_at: new Date('2026-10-10T19:30:00+03:00'),
    status: 'scheduled',
    seat_capacity: 31,
    revenue: 19000,
    tickets: 1,
    ...overrides,
  };
}

function tonightRow(overrides: Partial<TonightRow> = {}): TonightRow {
  return {
    showtime_id: 2,
    starts_at: new Date('2026-10-11T00:30:00+03:00'),
    ends_at: new Date('2026-10-11T02:30:00+03:00'),
    cinema_date: '2026-10-10',
    seat_capacity: 31,
    theater_id: 3,
    theater_name: 'Zamalek',
    hall_id: 30,
    hall_name: 'Hall 1',
    movie_id: 300,
    movie_title: 'The Nile Light',
    tickets: 1,
    revenue: 23000,
    total_count: 26,
    ...overrides,
  };
}

describe('OverviewService', () => {
  const calls: string[] = [];
  const logged = <T>(name: string, value: T) =>
    jest.fn((..._args: unknown[]) => {
      calls.push(name);
      return Promise.resolve(value);
    });
  let repository: jest.Mocked<OverviewRepository>;
  let settlement: { settleAllDue: jest.Mock };
  let service: OverviewService;
  const clock = new TestClock(NOW);

  beforeEach(() => {
    calls.length = 0;
    clock.set(NOW);
    repository = {
      showtimeAggregates: logged('showtimes', [showtime()]),
      methodSplit: logged('methods', [{ theater_id: 3, method: 'card', amount: 19000 }]),
      dailyRevenue: logged('daily', [{ cinema_date: '2026-10-10', theater_id: 3, revenue: 19000 }]),
      tonight: logged('tonight', [tonightRow()]),
      findTheater: logged('theater', { id: 3, name: 'Zamalek' }),
      theaterNames: logged('theaterNames', [{ id: 3, name: 'Zamalek' }]),
      hallNames: logged('hallNames', [{ id: 30, name: 'Hall 1' }]),
      movieTitles: logged('movieTitles', [{ id: 300, name: 'The Nile Light' }]),
    } as unknown as jest.Mocked<OverviewRepository>;
    settlement = { settleAllDue: logged('settle', { settled: 0 }) };
    // The Payments screen's period rules are a collaborator here; only its clock matters.
    const payments = new PaymentsReportService(
      {} as PaymentsReportRepository,
      settlement as unknown as SettlementService,
      {} as PaymentProvider,
      {} as StaffService,
      clock,
    );
    service = new OverviewService(
      repository,
      payments,
      settlement as unknown as SettlementService,
      clock,
    );
  });

  describe('periodOf', () => {
    it("resolves the presets against today's cinema day, not the calendar day", () => {
      expect(service.periodOf({ period: 'today' })).toMatchObject({
        preset: 'today',
        dateFrom: '2026-10-10',
        dateTo: '2026-10-10',
        days: 1,
      });
      expect(service.periodOf({ period: '7d' })).toMatchObject({
        dateFrom: '2026-10-04',
        dateTo: '2026-10-10',
        days: 7,
      });
      expect(service.periodOf({ period: '30d' })).toMatchObject({
        dateFrom: '2026-09-11',
        dateTo: '2026-10-10',
        days: 30,
      });
    });

    it('takes dates as the Payments screen does, the last 7 days by default', () => {
      expect(service.periodOf({})).toMatchObject({
        preset: null,
        dateFrom: '2026-10-04',
        dateTo: '2026-10-10',
        days: 7,
      });
      expect(service.periodOf({ dateFrom: '2026-10-01', dateTo: '2026-10-03' })).toMatchObject({
        preset: null,
        days: 3,
        from: new Date('2026-10-01T06:00:00+03:00'),
        to: new Date('2026-10-04T06:00:00+03:00'),
      });
    });

    it("refuses a preset with dates, and the Payments screen's bad periods", () => {
      const fieldOf = (run: () => unknown) => {
        try {
          run();
        } catch (error) {
          expect(error).toBeInstanceOf(AppError);
          return (error as AppError).details;
        }
        throw new Error('expected a refusal');
      };
      expect(fieldOf(() => service.periodOf({ period: 'today', dateTo: '2026-10-10' }))).toEqual({
        fields: [
          { field: 'period', messages: ['period cannot be combined with dateFrom or dateTo'] },
        ],
      });
      expect(
        fieldOf(() => service.periodOf({ dateFrom: '2026-10-12', dateTo: '2026-10-11' })),
      ).toMatchObject({ fields: [{ field: 'dateTo' }] });
      expect(
        fieldOf(() => service.periodOf({ dateFrom: '2025-01-01', dateTo: '2026-10-10' })),
      ).toMatchObject({ fields: [{ field: 'dateFrom' }] });
    });
  });

  describe('read', () => {
    it('settles first, then reads the period, its comparison, the trend and Tonight', async () => {
      const overview = await service.read({ period: 'today' });
      expect(calls).toEqual([
        'settle',
        'showtimes',
        'methods',
        'showtimes',
        'methods',
        'daily',
        'tonight',
        'theaterNames',
        'movieTitles',
      ]);
      expect(repository.showtimeAggregates.mock.calls).toEqual([
        ['2026-10-10', '2026-10-10', undefined],
        ['2026-10-03', '2026-10-03', undefined],
      ]);
      expect(repository.dailyRevenue).toHaveBeenCalledWith('2026-09-11', '2026-10-10', undefined);
      expect(repository.tonight).toHaveBeenCalledWith('2026-10-10', NOW, undefined, 20);
      expect(overview.comparison).toMatchObject({
        basis: 'same_weekday_last_week',
        dateFrom: '2026-10-03',
        days: 1,
        from: new Date('2026-10-03T06:00:00+03:00'),
      });
      expect(overview).toMatchObject({
        theater: null,
        byHall: null,
        cinemaDate: '2026-10-10',
        serverTime: NOW,
      });
      expect(overview.tonight).toMatchObject({ cinemaDate: '2026-10-10', total: 26 });
      expect(overview.tonight.items[0]).toMatchObject({ showtimeId: 2, hasStarted: true });
      expect(overview.byTheater[0]!.theater).toEqual({ id: 3, name: 'Zamalek' });
      expect(overview.topMovies[0]!.movie).toEqual({ id: 300, name: 'The Nile Light' });
    });

    it('scopes every read to the selected theater and adds revenue by hall', async () => {
      const overview = await service.read({ period: '7d', theaterId: 3 });
      expect(calls[0]).toBe('theater');
      expect(repository.showtimeAggregates).toHaveBeenCalledWith('2026-10-04', '2026-10-10', 3);
      expect(repository.methodSplit).toHaveBeenCalledWith('2026-09-27', '2026-10-03', 3);
      expect(repository.tonight).toHaveBeenCalledWith('2026-10-10', NOW, 3, 20);
      expect(repository.hallNames).toHaveBeenCalledWith([30]);
      expect(overview.theater).toEqual({ id: 3, name: 'Zamalek' });
      expect(overview.byHall).toEqual([
        expect.objectContaining({ hall: { id: 30, name: 'Hall 1' }, showtimeCount: 1 }),
      ]);
    });

    it('answers NOT_FOUND for an unknown theater before settling or reading', async () => {
      repository.findTheater.mockResolvedValue(undefined);
      await expect(service.read({ theaterId: 99 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(settlement.settleAllDue).not.toHaveBeenCalled();
      expect(repository.showtimeAggregates).not.toHaveBeenCalled();
    });

    it('refuses a bad period before any read', async () => {
      await expect(service.read({ period: '7d', dateFrom: '2026-10-01' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      expect(calls).toEqual([]);
    });

    it('answers an empty Tonight with a zero total', async () => {
      repository.tonight.mockResolvedValue([]);
      expect((await service.read({})).tonight).toEqual({
        cinemaDate: '2026-10-10',
        items: [],
        total: 0,
      });
    });
  });
});
