import {
  failedPaymentsAlert,
  failedPaymentsKey,
  hallGapAlert,
  hallGapKey,
  lowSalesAlert,
  lowSalesKey,
  sortAlerts,
  startAfter,
  withReadState,
} from '../../../../src/modules/analytics/alerts';
import { ALERT_KEY_PATTERN } from '../../../../src/modules/analytics/analytics.constants';
import type { HallGapRow, LowSalesRow, StaffAlert } from '../../../../src/modules/analytics/types';

function lowSalesRow(overrides: Partial<LowSalesRow> = {}): LowSalesRow {
  return {
    showtime_id: 81,
    starts_at: new Date('2026-10-10T23:30:00+03:00'),
    seat_capacity: 192,
    theater_id: 3,
    theater_name: 'Maqady Zamalek',
    hall_id: 30,
    hall_name: 'Hall 3',
    movie_id: 300,
    movie_title: 'Midnight Tram',
    tickets: 54,
    ...overrides,
  };
}

function gapRow(overrides: Partial<HallGapRow> = {}): HallGapRow {
  return {
    hall_id: 40,
    hall_name: 'Hall 4',
    theater_id: 3,
    theater_name: 'Maqady Zamalek',
    cinema_date: '2026-10-17',
    ...overrides,
  };
}

const unread = (alert: ReturnType<typeof hallGapAlert>): StaffAlert => ({
  ...alert,
  read: false,
  readAt: null,
});

describe('alerts', () => {
  it('builds stable keys in the key alphabet', () => {
    expect(failedPaymentsKey('2026-10-10', 6)).toBe('failed-payments:2026-10-10:6');
    expect(lowSalesKey(81)).toBe('low-sales:81');
    expect(hallGapKey(40, '2026-10-17')).toBe('hall-gap:40:2026-10-17');
    for (const key of [
      failedPaymentsKey('2026-10-10', 6),
      lowSalesKey(81),
      hallGapKey(40, '2026-10-17'),
    ]) {
      expect(ALERT_KEY_PATTERN.test(key)).toBe(true);
    }
  });

  it('raises failed payments only when some failed, with the count in its key and title', () => {
    expect(failedPaymentsAlert('2026-10-10', 0)).toBeNull();
    expect(failedPaymentsAlert('2026-10-10', 1)).toMatchObject({
      key: 'failed-payments:2026-10-10:1',
      title: '1 online payment failed today',
      failedPayments: { count: 1 },
    });
    expect(failedPaymentsAlert('2026-10-10', 6)).toEqual({
      key: 'failed-payments:2026-10-10:6',
      kind: 'failed_payments',
      cinemaDate: '2026-10-10',
      title: '6 online payments failed today',
      failedPayments: { count: 6 },
      lowSales: null,
      hallGap: null,
    });
  });

  it('describes a low-sales showtime with its Cairo start time and a percentage rounded down', () => {
    const alert = lowSalesAlert(lowSalesRow(), '2026-10-10');
    expect(alert).toEqual({
      key: 'low-sales:81',
      kind: 'low_sales',
      cinemaDate: '2026-10-10',
      title: 'Midnight Tram 23:30 in Hall 3, Maqady Zamalek, is 28% sold',
      failedPayments: null,
      lowSales: {
        showtimeId: 81,
        startsAt: new Date('2026-10-10T23:30:00+03:00'),
        movie: { id: 300, name: 'Midnight Tram' },
        theater: { id: 3, name: 'Maqady Zamalek' },
        hall: { id: 30, name: 'Hall 3' },
        ticketsSold: 54,
        seatCapacity: 192,
        soldShare: 0.2813,
      },
      hallGap: null,
    });
    // 69 of 199 is 34.67%: rounded it would read 35%, so it is rounded down, under the threshold.
    expect(
      lowSalesAlert(lowSalesRow({ tickets: 69, seat_capacity: 199 }), '2026-10-10').title,
    ).toMatch(/is 34% sold$/);
  });

  it('describes a hall gap on its own cinema date', () => {
    expect(hallGapAlert(gapRow())).toEqual({
      key: 'hall-gap:40:2026-10-17',
      kind: 'hall_gap',
      cinemaDate: '2026-10-17',
      title: 'Hall 4 at Maqady Zamalek has no showtimes on 2026-10-17',
      failedPayments: null,
      lowSales: null,
      hallGap: {
        hall: { id: 40, name: 'Hall 4' },
        theater: { id: 3, name: 'Maqady Zamalek' },
      },
    });
  });

  it('marks the keys this member has seen, with when', () => {
    const seenAt = new Date('2026-10-10T09:00:00+03:00');
    const states = withReadState(
      [hallGapAlert(gapRow()), hallGapAlert(gapRow({ hall_id: 41 }))],
      [
        { alert_key: 'hall-gap:41:2026-10-17', seen_at: seenAt },
        { alert_key: 'hall-gap:99:2026-10-17', seen_at: seenAt },
      ],
    );
    expect(states.map((state) => [state.key, state.read, state.readAt])).toEqual([
      ['hall-gap:40:2026-10-17', false, null],
      ['hall-gap:41:2026-10-17', true, seenAt],
    ]);
  });

  it('sorts unread first, then by kind, start time, day, theater and hall', () => {
    const failed = unread(failedPaymentsAlert('2026-10-10', 2)!);
    const late = unread(lowSalesAlert(lowSalesRow(), '2026-10-10'));
    const early = unread(
      lowSalesAlert(
        lowSalesRow({ showtime_id: 90, starts_at: new Date('2026-10-10T19:00:00+03:00') }),
        '2026-10-10',
      ),
    );
    const gapLater = unread(hallGapAlert(gapRow({ cinema_date: '2026-10-12' })));
    const gapB = unread(
      hallGapAlert(gapRow({ hall_id: 50, hall_name: 'Hall 1', theater_name: 'Maqady Maadi' })),
    );
    const gapA = unread(hallGapAlert(gapRow({ cinema_date: '2026-10-11' })));
    const readFailed = { ...failed, read: true };
    expect(
      sortAlerts([gapB, readFailed, gapLater, late, gapA, early]).map((alert) => alert.key),
    ).toEqual([
      'low-sales:90',
      'low-sales:81',
      'hall-gap:40:2026-10-11',
      'hall-gap:40:2026-10-12',
      'hall-gap:50:2026-10-17',
      'failed-payments:2026-10-10:2',
    ]);
  });

  it('continues a page after its last key, or at its position once that key is gone', () => {
    const list = ['11', '12', '14', '15'].map((day) =>
      unread(hallGapAlert(gapRow({ cinema_date: `2026-10-${day}` }))),
    );
    expect(startAfter(list, 'hall-gap:40:2026-10-12', 2)).toBe(2);
    expect(startAfter(list, 'hall-gap:40:2026-10-13', 2)).toBe(2);
    expect(startAfter(list, 'hall-gap:40:2026-10-13', 9)).toBe(4);
  });
});
