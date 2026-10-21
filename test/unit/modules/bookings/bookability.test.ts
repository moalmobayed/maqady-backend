import { notBookableReason } from '../../../../src/modules/bookings/bookability';
import type { BookabilityInput } from '../../../../src/modules/bookings/types';

const NOW = new Date('2026-10-16T19:00:00+03:00');
const BOOKABLE: BookabilityInput = {
  showtimeStatus: 'scheduled',
  startsAt: new Date(NOW.getTime() + 1),
  theaterStatus: 'active',
  movieStatus: 'now_showing',
  hallStatus: 'active',
};

describe('notBookableReason', () => {
  it('is null for a scheduled showtime not yet started, in an active theater and hall, of a Now showing movie', () => {
    expect(notBookableReason(BOOKABLE, NOW)).toBeNull();
  });

  it.each([
    [{ showtimeStatus: 'cancelled' }, 'cancelled'],
    [{ startsAt: NOW }, 'started'],
    [{ theaterStatus: 'sales_paused' }, 'sales_paused'],
    [{ movieStatus: 'archived' }, 'movie_unavailable'],
    [{ hallStatus: 'retired' }, 'hall_unavailable'],
  ] as const)('%j gives %s', (change, reason) => {
    expect(notBookableReason({ ...BOOKABLE, ...change }, NOW)).toBe(reason);
  });

  it('reports the first reason in precedence order', () => {
    const everything: BookabilityInput = {
      showtimeStatus: 'cancelled',
      startsAt: NOW,
      theaterStatus: 'sales_paused',
      movieStatus: 'archived',
      hallStatus: 'draft',
    };
    expect(notBookableReason(everything, NOW)).toBe('cancelled');
    expect(notBookableReason({ ...everything, showtimeStatus: 'scheduled' }, NOW)).toBe('started');
    expect(
      notBookableReason(
        { ...everything, showtimeStatus: 'scheduled', startsAt: new Date(NOW.getTime() + 1) },
        NOW,
      ),
    ).toBe('sales_paused');
    expect(
      notBookableReason({ ...BOOKABLE, movieStatus: 'coming_soon', hallStatus: 'draft' }, NOW),
    ).toBe('movie_unavailable');
  });
});
