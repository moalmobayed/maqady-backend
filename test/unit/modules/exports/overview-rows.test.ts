import type { AdminOverviewResponse } from '../../../../src/modules/analytics/dto/admin-overview.response';
import { overviewRows } from '../../../../src/modules/exports/overview-rows';
import type { OverviewFigureRow } from '../../../../src/modules/exports/types';

const egp = (amount: number) => ({ amount, currency: 'EGP' as const });
const sales = { ticketsSold: 4, seatsOnSale: 100, occupancy: 0.04, showtimeCount: 2 };

const OVERVIEW = {
  period: {
    preset: '7d',
    dateFrom: '2026-10-04',
    dateTo: '2026-10-10',
    days: 7,
    from: '2026-10-04T06:00:00+03:00',
    to: '2026-10-11T06:00:00+03:00',
  },
  comparison: {
    basis: 'previous_period',
    dateFrom: '2026-09-27',
    dateTo: '2026-10-03',
    days: 7,
    from: '2026-09-27T06:00:00+03:00',
    to: '2026-10-04T06:00:00+03:00',
  },
  theater: { id: 3, name: 'Zamalek Cinema' },
  cinemaDate: '2026-10-10',
  serverTime: '2026-10-10T10:00:00+03:00',
  kpis: {
    revenue: { value: egp(76000), previous: egp(38000), change: 1 },
    ticketsSold: { value: 4, previous: 2, change: 1 },
    occupancy: { value: 0.04, previous: null, change: null },
    averageTicket: { value: egp(19000), previous: null, change: null },
    counterShare: { value: 0.25, previous: 0, change: null },
  },
  byTheater: [
    {
      theater: { id: 3, name: 'Zamalek Cinema' },
      revenue: egp(76000),
      ...sales,
      averageTicket: egp(19000),
      online: egp(57000),
      counter: egp(19000),
      previousRevenue: egp(38000),
      change: 1,
    },
  ],
  byHall: [{ hall: { id: 5, name: 'Hall 1' }, revenue: egp(76000), ...sales }],
  paymentMethods: [{ method: 'card', amount: egp(57000), share: 0.75 }],
  topMovies: [{ movie: { id: 12, name: '=The Nile Light' }, revenue: egp(76000), ...sales }],
  heatmap: [
    {
      weekday: 6,
      slot: '18_21',
      showtimeCount: 2,
      ticketsSold: 4,
      seatsOnSale: 100,
      occupancy: 0.04,
    },
  ],
  revenueTrend: {
    dateFrom: '2026-09-11',
    dateTo: '2026-10-10',
    totals: [{ cinemaDate: '2026-10-10', revenue: egp(76000) }],
    theaters: [
      {
        theater: { id: 3, name: 'Zamalek Cinema' },
        points: [{ cinemaDate: '2026-10-10', revenue: egp(76000) }],
      },
    ],
  },
  tonight: {
    cinemaDate: '2026-10-10',
    total: 1,
    items: [
      {
        showtimeId: 81,
        startsAt: '2026-10-10T19:30:00+03:00',
        endsAt: '2026-10-10T21:38:00+03:00',
        cinemaDate: '2026-10-10',
        hasStarted: false,
        movie: { id: 12, name: 'The Nile Light' },
        theater: { id: 3, name: 'Zamalek Cinema' },
        hall: { id: 5, name: 'Hall 1' },
        ticketsSold: 4,
        seatCapacity: 50,
        soldShare: 0.08,
        revenue: egp(76000),
      },
    ],
  },
} as unknown as AdminOverviewResponse;

function find(rows: OverviewFigureRow[], section: string, metric: string, subjectId?: number) {
  return rows.filter(
    (row) =>
      row.section === section &&
      row.metric === metric &&
      (subjectId === undefined || row.subjectId === subjectId),
  );
}

describe('overviewRows', () => {
  const rows = overviewRows(OVERVIEW);

  it('covers every section of the screen, in its order', () => {
    const sections = [...new Set(rows.map((row) => row.section))];
    expect(sections).toEqual([
      'period',
      'kpis',
      'by_theater',
      'by_hall',
      'payment_methods',
      'top_movies',
      'heatmap',
      'revenue_trend',
      'tonight',
    ]);
  });

  it('writes the period and the scope', () => {
    expect(find(rows, 'period', 'dateFrom')).toEqual([
      {
        section: 'period',
        cinemaDate: null,
        subjectId: 3,
        subject: 'Zamalek Cinema',
        metric: 'dateFrom',
        unit: 'date',
        value: '2026-10-04',
        previous: null,
        change: null,
      },
    ]);
    expect(find(rows, 'period', 'comparison')[0]?.value).toBe('previous_period');
  });

  it('writes each KPI with its previous value and change, money in pounds', () => {
    expect(find(rows, 'kpis', 'revenue')[0]).toMatchObject({
      unit: 'EGP',
      value: 760,
      previous: 380,
      change: 1,
    });
    expect(find(rows, 'kpis', 'occupancy')[0]).toMatchObject({
      unit: 'ratio',
      value: 0.04,
      previous: null,
      change: null,
    });
    expect(find(rows, 'kpis', 'averageTicket')[0]).toMatchObject({ value: 190, previous: null });
  });

  it('writes each theater, hall, method, movie, heatmap cell, trend point and show', () => {
    expect(find(rows, 'by_theater', 'revenue', 3)[0]).toMatchObject({
      value: 760,
      previous: 380,
      change: 1,
    });
    expect(find(rows, 'by_theater', 'online', 3)[0]?.value).toBe(570);
    expect(find(rows, 'by_theater', 'counter', 3)[0]?.value).toBe(190);
    expect(find(rows, 'by_theater', 'occupancy', 3)[0]?.value).toBe(0.04);
    expect(find(rows, 'by_hall', 'showtimeCount', 5)[0]?.value).toBe(2);
    expect(find(rows, 'payment_methods', 'share')[0]).toMatchObject({
      subject: 'card',
      value: 0.75,
    });
    expect(find(rows, 'top_movies', 'revenue', 12)[0]).toMatchObject({
      subject: '=The Nile Light',
    });
    expect(find(rows, 'heatmap', 'ticketsSold', 6)[0]).toMatchObject({
      subject: '18_21',
      value: 4,
    });
    expect(find(rows, 'revenue_trend', 'revenue')).toEqual([
      expect.objectContaining({ cinemaDate: '2026-10-10', subjectId: null, value: 760 }),
      expect.objectContaining({ cinemaDate: '2026-10-10', subjectId: 3, value: 760 }),
    ]);
    expect(find(rows, 'tonight', 'startsAt', 81)[0]).toMatchObject({
      cinemaDate: '2026-10-10',
      subject: 'The Nile Light',
      value: '2026-10-10T19:30:00+03:00',
    });
    expect(find(rows, 'tonight', 'soldShare', 81)[0]?.value).toBe(0.08);
  });

  it('leaves by_hall out for all theaters', () => {
    const all = overviewRows({ ...OVERVIEW, theater: null, byHall: null });
    expect(all.some((row) => row.section === 'by_hall')).toBe(false);
    expect(find(all, 'kpis', 'revenue')[0]).toMatchObject({
      subjectId: null,
      subject: 'All theaters',
    });
  });
});
