import { encodeCursor } from '../../../../src/common/pagination/cursor';
import type { AlertsRepository } from '../../../../src/modules/analytics/alerts.repository';
import { AlertsService } from '../../../../src/modules/analytics/alerts.service';
import type { HallGapRow, LowSalesRow } from '../../../../src/modules/analytics/types';
import type { SettlementService } from '../../../../src/modules/bookings/settlement.service';
import type { TheaterHoursService } from '../../../../src/modules/theaters/theater-hours.service';
import type { CinemaDateHours } from '../../../../src/modules/theaters/types';
import { TestClock } from '../../../support/clock';

/** 01:30 Cairo time on Sunday 11 October 2026: still the cinema day of Saturday the 10th. */
const NOW = new Date('2026-10-11T01:30:00+03:00');

const lowSales: LowSalesRow = {
  showtime_id: 81,
  starts_at: new Date('2026-10-11T02:00:00+03:00'),
  seat_capacity: 100,
  theater_id: 3,
  theater_name: 'Zamalek',
  hall_id: 30,
  hall_name: 'Hall 1',
  movie_id: 300,
  movie_title: 'Midnight Tram',
  tickets: 20,
};

const gap = (theaterId: number, cinemaDate: string): HallGapRow => ({
  hall_id: theaterId * 10,
  hall_name: 'Hall 1',
  theater_id: theaterId,
  theater_name: `Theater ${theaterId}`,
  cinema_date: cinemaDate,
});

/** A day's hours: open, or closed (no window). */
const day = (cinemaDate: string, open: boolean): CinemaDateHours => ({
  cinemaDate,
  weekday: 1,
  source: 'weekly',
  specialDateLabel: null,
  hours: null,
  window: open ? { opensAt: new Date(0), closesAt: new Date(1) } : null,
});

describe('AlertsService', () => {
  const calls: string[] = [];
  const logged = <T>(name: string, value: T) =>
    jest.fn((..._args: unknown[]) => {
      calls.push(name);
      return Promise.resolve(value);
    });
  let repository: jest.Mocked<AlertsRepository>;
  let hours: { hoursFor: jest.Mock };
  let settlement: { settleAllDue: jest.Mock };
  let service: AlertsService;
  const clock = new TestClock(NOW);

  beforeEach(() => {
    calls.length = 0;
    clock.set(NOW);
    repository = {
      failedOnlineChargeCount: logged('failed', 2),
      lowSalesShowtimes: logged('lowSales', [lowSales]),
      hallGaps: logged('gaps', [gap(3, '2026-10-12'), gap(4, '2026-10-12'), gap(3, '2026-10-13')]),
      readsOf: logged('reads', []),
      markSeen: logged('mark', 1),
      deleteSeenBefore: logged('tidy', 0),
    } as unknown as jest.Mocked<AlertsRepository>;
    hours = {
      hoursFor: logged(
        'hours',
        new Map([
          [3, [day('2026-10-12', true), day('2026-10-13', false)]],
          [4, [day('2026-10-12', false)]],
        ]),
      ),
    };
    settlement = { settleAllDue: logged('settle', { settled: 0 }) };
    service = new AlertsService(
      repository,
      hours as unknown as TheaterHoursService,
      settlement as unknown as SettlementService,
      clock,
    );
  });

  describe('current', () => {
    it("reads today's cinema day and the 7 days from it, keeping gaps on open days only", async () => {
      const alerts = await service.current(NOW);
      expect(repository.failedOnlineChargeCount).toHaveBeenCalledWith({
        from: new Date('2026-10-10T06:00:00+03:00'),
        to: new Date('2026-10-11T06:00:00+03:00'),
      });
      expect(repository.lowSalesShowtimes).toHaveBeenCalledWith('2026-10-10', NOW, 35);
      expect(repository.hallGaps).toHaveBeenCalledWith([
        '2026-10-10',
        '2026-10-11',
        '2026-10-12',
        '2026-10-13',
        '2026-10-14',
        '2026-10-15',
        '2026-10-16',
      ]);
      expect(hours.hoursFor).toHaveBeenCalledWith([3, 4, 3], '2026-10-10', '2026-10-16');
      expect(alerts.map((alert) => alert.key)).toEqual([
        'failed-payments:2026-10-10:2',
        'low-sales:81',
        'hall-gap:30:2026-10-12',
      ]);
    });

    it('raises no failed-payments alert without failures and skips the hours without gaps', async () => {
      repository.failedOnlineChargeCount.mockResolvedValue(0);
      repository.hallGaps.mockResolvedValue([]);
      expect((await service.current(NOW)).map((alert) => alert.key)).toEqual(['low-sales:81']);
      expect(hours.hoursFor).not.toHaveBeenCalled();
    });
  });

  describe('page', () => {
    it('settles first, then lists unread first with the counts of the whole list', async () => {
      repository.readsOf.mockResolvedValue([
        { alert_key: 'failed-payments:2026-10-10:2', seen_at: new Date('2026-10-10T20:00:00Z') },
      ]);
      const page = await service.page(7, {});
      expect(calls[0]).toBe('settle');
      expect(repository.readsOf).toHaveBeenCalledWith(7, [
        'failed-payments:2026-10-10:2',
        'low-sales:81',
        'hall-gap:30:2026-10-12',
      ]);
      expect(page.items.map((alert) => [alert.key, alert.read])).toEqual([
        ['low-sales:81', false],
        ['hall-gap:30:2026-10-12', false],
        ['failed-payments:2026-10-10:2', true],
      ]);
      expect(page).toMatchObject({
        total: 3,
        unreadCount: 2,
        nextCursor: null,
        cinemaDate: '2026-10-10',
        serverTime: NOW,
      });
    });

    it('pages with a cursor on the last key and its position', async () => {
      const first = await service.page(7, { limit: 2 });
      expect(first.items.map((alert) => alert.key)).toEqual([
        'failed-payments:2026-10-10:2',
        'low-sales:81',
      ]);
      expect(first.nextCursor).toBe(encodeCursor({ sortKey: 'low-sales:81', id: 2 }));
      const second = await service.page(7, { limit: 2, cursor: first.nextCursor! });
      expect(second.items.map((alert) => alert.key)).toEqual(['hall-gap:30:2026-10-12']);
      expect(second.nextCursor).toBeNull();
    });

    it('refuses a bad cursor or limit before settling', async () => {
      await expect(service.page(7, { cursor: 'nope' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      await expect(service.page(7, { limit: 0 })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      expect(settlement.settleAllDue).not.toHaveBeenCalled();
    });
  });

  describe('markRead', () => {
    it('marks every current key when none is given, tidies old reads, and never settles', async () => {
      repository.readsOf.mockResolvedValue([
        { alert_key: 'low-sales:81', seen_at: NOW },
        { alert_key: 'hall-gap:30:2026-10-12', seen_at: NOW },
      ]);
      const result = await service.markRead(7, undefined);
      expect(repository.markSeen).toHaveBeenCalledWith(
        7,
        ['failed-payments:2026-10-10:2', 'low-sales:81', 'hall-gap:30:2026-10-12'],
        NOW,
      );
      expect(repository.deleteSeenBefore).toHaveBeenCalledWith(
        7,
        new Date('2026-09-10T22:30:00.000Z'),
      );
      expect(settlement.settleAllDue).not.toHaveBeenCalled();
      expect(result).toEqual({ markedCount: 1, unreadCount: 1, total: 3 });
    });

    it('marks only the given keys that are current, each once', async () => {
      await service.markRead(7, [
        'low-sales:81',
        'low-sales:81',
        'failed-payments:2026-10-10:1',
        'hall-gap:99:2026-10-12',
      ]);
      expect(repository.markSeen).toHaveBeenCalledWith(7, ['low-sales:81'], NOW);
    });
  });
});
