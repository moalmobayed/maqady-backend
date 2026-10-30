import {
  comparisonDatesOf,
  datesBetween,
  figuresOf,
  hallRevenueOf,
  heatmapOf,
  kpisOf,
  namedIdsOf,
  paymentMethodsOf,
  ratioOf,
  relativeChange,
  revenueTrendOf,
  slotOf,
  theaterRevenueOf,
  tonightShowtimeOf,
  topMoviesOf,
} from '../../../../src/modules/analytics/overview';
import type {
  MethodSplitRow,
  PeriodRows,
  ShowtimeAggregateRow,
  TonightRow,
} from '../../../../src/modules/analytics/types';

const money = (amount: number) => ({ amount, currency: 'EGP' });

function showtime(overrides: Partial<ShowtimeAggregateRow> = {}): ShowtimeAggregateRow {
  return {
    showtime_id: 1,
    theater_id: 3,
    hall_id: 30,
    movie_id: 300,
    cinema_date: '2026-10-10',
    starts_at: new Date('2026-10-10T19:30:00+03:00'),
    status: 'scheduled',
    seat_capacity: 100,
    revenue: 0,
    tickets: 0,
    ...overrides,
  };
}

const method = (overrides: Partial<MethodSplitRow>): MethodSplitRow => ({
  theater_id: 3,
  method: 'card',
  amount: 0,
  ...overrides,
});

const rows = (showtimes: ShowtimeAggregateRow[], methods: MethodSplitRow[] = []): PeriodRows => ({
  showtimes,
  methods,
});

describe('Overview folds', () => {
  describe('ratioOf and relativeChange', () => {
    it('rounds to 4 decimals and is null with nothing to divide by', () => {
      expect(ratioOf(5, 93)).toBe(0.0538);
      expect(ratioOf(1, 3)).toBe(0.3333);
      expect(ratioOf(2, 3)).toBe(0.6667);
      expect(ratioOf(0, 10)).toBe(0);
      expect(ratioOf(3, 0)).toBeNull();
    });

    it('gives the change against a previous value, null from zero or null', () => {
      expect(relativeChange(99000, 19000)).toBe(4.2105);
      expect(relativeChange(80, 100)).toBe(-0.2);
      expect(relativeChange(5, 0)).toBeNull();
      expect(relativeChange(null, 3)).toBeNull();
      expect(relativeChange(3, null)).toBeNull();
    });
  });

  describe('periods', () => {
    it('lists every date of a period, across a month end', () => {
      expect(datesBetween('2026-09-29', '2026-10-02')).toEqual([
        '2026-09-29',
        '2026-09-30',
        '2026-10-01',
        '2026-10-02',
      ]);
      expect(datesBetween('2026-10-10', '2026-10-10')).toEqual(['2026-10-10']);
    });

    it('compares a single day with the same weekday last week', () => {
      expect(comparisonDatesOf('2026-10-10', '2026-10-10', 1)).toEqual({
        dateFrom: '2026-10-03',
        dateTo: '2026-10-03',
        basis: 'same_weekday_last_week',
      });
    });

    it('compares a longer period with the days just before it', () => {
      expect(comparisonDatesOf('2026-10-04', '2026-10-10', 7)).toEqual({
        dateFrom: '2026-09-27',
        dateTo: '2026-10-03',
        basis: 'previous_period',
      });
      expect(comparisonDatesOf('2026-09-11', '2026-10-10', 30)).toEqual({
        dateFrom: '2026-08-12',
        dateTo: '2026-09-10',
        basis: 'previous_period',
      });
    });
  });

  describe('slotOf', () => {
    it.each([
      ['2026-10-10T06:00:00+03:00', 'before_15'],
      ['2026-10-10T11:00:00+03:00', 'before_15'],
      ['2026-10-10T14:59:00+03:00', 'before_15'],
      ['2026-10-10T15:00:00+03:00', '15_18'],
      ['2026-10-10T17:59:00+03:00', '15_18'],
      ['2026-10-10T18:00:00+03:00', '18_21'],
      ['2026-10-10T21:00:00+03:00', '21_24'],
      ['2026-10-10T23:59:00+03:00', '21_24'],
      ['2026-10-11T00:00:00+03:00', 'after_midnight'],
      ['2026-10-11T05:59:00+03:00', 'after_midnight'],
      // Winter time (UTC+2): 21:30 local is 19:30 UTC.
      ['2026-11-05T21:30:00+02:00', '21_24'],
    ])('puts a show starting at %s in %s, by Cairo wall time', (instant, slot) => {
      expect(slotOf(new Date(instant))).toBe(slot);
    });
  });

  describe('figuresOf and kpisOf', () => {
    it('counts revenue and tickets of every showtime, occupancy of the scheduled ones', () => {
      const figures = figuresOf(
        rows(
          [
            showtime({ revenue: 57000, tickets: 3, seat_capacity: 31 }),
            showtime({ showtime_id: 2, revenue: 23000, tickets: 1, seat_capacity: 31 }),
            showtime({ showtime_id: 3, status: 'cancelled', seat_capacity: 31 }),
          ],
          [method({ method: 'card', amount: 61000 }), method({ method: 'cash', amount: 19000 })],
        ),
      );
      expect(figures).toEqual({
        revenue: money(80000),
        ticketsSold: 4,
        seatsOnSale: 62,
        occupancy: 0.0645,
        averageTicket: money(20000),
        counterShare: 0.2375,
      });
    });

    it('rounds the average ticket to whole piastres and empties what cannot be divided', () => {
      expect(
        figuresOf(rows([showtime({ revenue: 145000, tickets: 7, seat_capacity: 124 })]))
          .averageTicket,
      ).toEqual(money(20714));
      expect(figuresOf(rows([]))).toEqual({
        revenue: money(0),
        ticketsSold: 0,
        seatsOnSale: 0,
        occupancy: null,
        averageTicket: null,
        counterShare: null,
      });
    });

    it('counts card-terminal and cash as the counter, card and wallet as online', () => {
      expect(
        figuresOf(
          rows(
            [],
            [
              method({ method: 'card', amount: 100 }),
              method({ method: 'wallet', amount: 100 }),
              method({ method: 'cash', amount: 100 }),
              method({ method: 'card_terminal', amount: 100 }),
            ],
          ),
        ).counterShare,
      ).toBe(0.5);
    });

    it('pairs each figure with the previous one and its change', () => {
      const current = figuresOf(
        rows([showtime({ revenue: 99000, tickets: 5, seat_capacity: 93 })]),
      );
      const previous = figuresOf(
        rows([showtime({ revenue: 19000, tickets: 1, seat_capacity: 31 })]),
      );
      expect(kpisOf(current, previous)).toEqual({
        revenue: { value: money(99000), previous: money(19000), change: 4.2105 },
        ticketsSold: { value: 5, previous: 1, change: 4 },
        occupancy: { value: 0.0538, previous: 0.0323, change: 0.6656 },
        averageTicket: { value: money(19800), previous: money(19000), change: 0.0421 },
        counterShare: { value: null, previous: null, change: null },
      });
    });
  });

  describe('theaterRevenueOf', () => {
    it('lists theaters by revenue with their split and comparison, a lost theater included', () => {
      const theaters = new Map([
        [3, 'Zamalek'],
        [4, 'Maadi'],
        [5, 'Heliopolis'],
      ]);
      const result = theaterRevenueOf(
        rows(
          [
            showtime({ theater_id: 3, revenue: 19000, tickets: 1, seat_capacity: 31 }),
            showtime({ theater_id: 4, revenue: 80000, tickets: 4, seat_capacity: 62 }),
          ],
          [
            method({ theater_id: 4, method: 'card', amount: 61000 }),
            method({ theater_id: 4, method: 'cash', amount: 19000 }),
            method({ theater_id: 3, method: 'wallet', amount: 19000 }),
          ],
        ),
        rows([
          showtime({ theater_id: 4, revenue: 19000 }),
          showtime({ theater_id: 5, revenue: 5000 }),
          showtime({ theater_id: 6, revenue: 0 }),
        ]),
        theaters,
      );
      expect(result.map((row) => [row.theater.name, row.revenue.amount, row.change])).toEqual([
        ['Maadi', 80000, 3.2105],
        ['Zamalek', 19000, null],
        ['Heliopolis', 0, -1],
      ]);
      expect(result[0]).toMatchObject({
        online: money(61000),
        counter: money(19000),
        previousRevenue: money(19000),
        averageTicket: money(20000),
        occupancy: 0.0645,
        showtimeCount: 1,
      });
      expect(result[2]).toMatchObject({ seatsOnSale: 0, occupancy: null, averageTicket: null });
    });
  });

  describe('hallRevenueOf and topMoviesOf', () => {
    it('groups by hall, highest revenue first, then by name', () => {
      const result = hallRevenueOf(
        [
          showtime({ hall_id: 31, revenue: 100 }),
          showtime({ hall_id: 30, revenue: 100 }),
          showtime({ hall_id: 32, revenue: 500, tickets: 2 }),
          showtime({ hall_id: 32, revenue: 200, tickets: 1, status: 'cancelled' }),
        ],
        new Map([
          [30, 'Hall 1'],
          [31, 'Hall 2'],
          [32, 'Hall 3'],
        ]),
      );
      expect(result.map((row) => [row.hall.name, row.revenue.amount, row.showtimeCount])).toEqual([
        ['Hall 3', 700, 1],
        ['Hall 1', 100, 1],
        ['Hall 2', 100, 1],
      ]);
    });

    it('keeps the top movies by revenue, then tickets, then title', () => {
      const result = topMoviesOf(
        [
          showtime({ movie_id: 1, revenue: 300, tickets: 1 }),
          showtime({ movie_id: 2, revenue: 300, tickets: 2 }),
          showtime({ movie_id: 3, revenue: 900, tickets: 3 }),
          showtime({ movie_id: 4, revenue: 300, tickets: 1 }),
        ],
        new Map([
          [1, 'Zeta'],
          [2, 'Beta'],
          [3, 'Gamma'],
          [4, 'Alpha'],
        ]),
        3,
      );
      expect(result.map((row) => row.movie.name)).toEqual(['Gamma', 'Beta', 'Alpha']);
    });
  });

  describe('paymentMethodsOf', () => {
    it('lists all four methods with their shares, summed over theaters', () => {
      expect(
        paymentMethodsOf([
          method({ theater_id: 3, method: 'card', amount: 30000 }),
          method({ theater_id: 4, method: 'card', amount: 31000 }),
          method({ method: 'cash', amount: 19000 }),
          method({ method: 'wallet', amount: 19000 }),
        ]),
      ).toEqual([
        { method: 'card', amount: money(61000), share: 0.6162 },
        { method: 'wallet', amount: money(19000), share: 0.1919 },
        { method: 'cash', amount: money(19000), share: 0.1919 },
        { method: 'card_terminal', amount: money(0), share: 0 },
      ]);
      expect(paymentMethodsOf([]).map((row) => row.share)).toEqual([null, null, null, null]);
    });
  });

  describe('heatmapOf', () => {
    it('fills all 35 cells by the cinema date weekday and slot, scheduled showtimes only', () => {
      const cells = heatmapOf([
        // Saturday 10 Oct 19:30 and its after-midnight show (Sunday 00:30 by the calendar).
        showtime({ tickets: 30, seat_capacity: 100 }),
        showtime({
          showtime_id: 2,
          starts_at: new Date('2026-10-11T00:30:00+03:00'),
          tickets: 5,
          seat_capacity: 50,
        }),
        showtime({ showtime_id: 3, status: 'cancelled', tickets: 0, seat_capacity: 100 }),
      ]);
      expect(cells).toHaveLength(35);
      expect(cells[0]).toEqual({
        weekday: 1,
        slot: 'before_15',
        showtimeCount: 0,
        ticketsSold: 0,
        seatsOnSale: 0,
        occupancy: null,
      });
      const at = (weekday: number, slot: string) =>
        cells.find((cell) => cell.weekday === weekday && cell.slot === slot);
      expect(at(6, '18_21')).toMatchObject({ showtimeCount: 1, ticketsSold: 30, occupancy: 0.3 });
      expect(at(6, 'after_midnight')).toMatchObject({ showtimeCount: 1, occupancy: 0.1 });
      expect(at(7, 'after_midnight')).toMatchObject({ showtimeCount: 0 });
    });
  });

  describe('revenueTrendOf', () => {
    it('fills every date with zero, per theater with revenue and the selected one', () => {
      const trend = revenueTrendOf(
        [
          { cinema_date: '2026-10-02', theater_id: 4, revenue: 500 },
          { cinema_date: '2026-10-02', theater_id: 3, revenue: 100 },
        ],
        ['2026-10-01', '2026-10-02', '2026-10-03'],
        new Map([
          [3, 'Zamalek'],
          [4, 'Maadi'],
          [9, 'Dokki'],
        ]),
        9,
      );
      expect(trend.dateFrom).toBe('2026-10-01');
      expect(trend.dateTo).toBe('2026-10-03');
      expect(trend.totals.map((point) => point.revenue.amount)).toEqual([0, 600, 0]);
      expect(
        trend.theaters.map((line) => [
          line.theater.name,
          line.points.map((point) => point.revenue.amount),
        ]),
      ).toEqual([
        ['Dokki', [0, 0, 0]],
        ['Maadi', [0, 500, 0]],
        ['Zamalek', [0, 100, 0]],
      ]);
    });
  });

  describe('tonightShowtimeOf and namedIdsOf', () => {
    it('marks a started showtime and gives its sold share', () => {
      const row: TonightRow = {
        showtime_id: 7,
        starts_at: new Date('2026-10-10T19:30:00+03:00'),
        ends_at: new Date('2026-10-10T21:30:00+03:00'),
        cinema_date: '2026-10-10',
        seat_capacity: 31,
        theater_id: 3,
        theater_name: 'Zamalek',
        hall_id: 30,
        hall_name: 'Hall 1',
        movie_id: 300,
        movie_title: 'The Nile Light',
        tickets: 3,
        revenue: 57000,
        total_count: 1,
      };
      expect(tonightShowtimeOf(row, new Date('2026-10-10T19:29:59+03:00'))).toMatchObject({
        hasStarted: false,
        soldShare: 0.0968,
        movie: { id: 300, name: 'The Nile Light' },
        revenue: money(57000),
      });
      expect(tonightShowtimeOf(row, new Date('2026-10-10T19:30:00+03:00')).hasStarted).toBe(true);
    });

    it('collects each named id once', () => {
      expect(
        namedIdsOf([
          showtime(),
          showtime({ showtime_id: 2, hall_id: 31 }),
          showtime({ theater_id: 4, movie_id: 301 }),
        ]),
      ).toEqual({ theaterIds: [3, 4], hallIds: [30, 31], movieIds: [300, 301] });
    });
  });
});
