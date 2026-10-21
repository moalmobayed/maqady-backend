import { cinemaDatesFrom, showDateRange } from '../../../../src/modules/discovery/show-dates';

describe('show dates', () => {
  it('lists consecutive cinema dates, across a month end', () => {
    expect(cinemaDatesFrom('2026-10-29', 4)).toEqual([
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
  });

  it('is today, or tomorrow', () => {
    expect(showDateRange('today', '2026-10-16')).toEqual({ from: '2026-10-16', to: '2026-10-16' });
    expect(showDateRange('tomorrow', '2026-10-31')).toEqual({
      from: '2026-11-01',
      to: '2026-11-01',
    });
  });

  it.each([
    ['Monday', '2026-10-12', '2026-10-16', '2026-10-17'],
    ['Wednesday', '2026-10-14', '2026-10-16', '2026-10-17'],
    ['Thursday', '2026-10-15', '2026-10-16', '2026-10-17'],
    ['Friday', '2026-10-16', '2026-10-16', '2026-10-17'],
    ['Saturday', '2026-10-17', '2026-10-17', '2026-10-17'],
    ['Sunday', '2026-10-18', '2026-10-23', '2026-10-24'],
  ])('makes this weekend Friday and Saturday on a %s', (_, today, from, to) => {
    expect(showDateRange('weekend', today)).toEqual({ from, to });
  });
});
