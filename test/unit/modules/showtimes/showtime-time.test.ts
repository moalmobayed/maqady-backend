import { AppError } from '../../../../src/common/errors/app-error';
import { money } from '../../../../src/common/money/money';
import { cinemaDateOf, formatCairoIso } from '../../../../src/common/time/time';
import {
  cinemaMinuteOf,
  fitsWindow,
  fromPrice,
  overlaps,
  showtimeSpan,
  startInstantFor,
  startInstantOrNull,
  startTimeOf,
  suggestStarts,
} from '../../../../src/modules/showtimes/showtime-time';
import type { BusySlot } from '../../../../src/modules/showtimes/types';

// Cairo 2026: summer time starts Friday 24 April at 00:00 (clocks jump to 01:00) and ends
// Thursday 29 October at 24:00 (clocks fall back to 23:00).
const at = (iso: string): Date => new Date(iso);
const iso = (instant: Date | null): string | null => (instant ? formatCairoIso(instant) : null);

function caught(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

const WINDOW = {
  opensAt: at('2026-10-16T12:00:00+03:00'),
  closesAt: at('2026-10-17T01:00:00+03:00'),
};

function busy(id: number, startsAt: string, runtimeMinutes: number): BusySlot {
  return { id, movieId: 1, ...showtimeSpan(at(startsAt), runtimeMinutes) };
}

describe('cinema minutes and start times', () => {
  it('puts 06:00–23:59 on the cinema date and 00:00–05:59 after midnight', () => {
    expect(cinemaMinuteOf('06:00')).toBe(360);
    expect(cinemaMinuteOf('23:59')).toBe(1439);
    expect(cinemaMinuteOf('00:30')).toBe(1470);
    expect(cinemaMinuteOf('05:59')).toBe(1799);
    expect(startTimeOf(1470)).toBe('00:30');
    expect(startTimeOf(360)).toBe('06:00');
    expect(caught(() => cinemaMinuteOf('7:30')).code).toBe('INTERNAL');
  });
});

describe('startInstantFor', () => {
  it('starts 00:30 on the next calendar day, which still belongs to the cinema date', () => {
    const startsAt = startInstantFor('2026-10-16', '00:30');
    expect(iso(startsAt)).toBe('2026-10-17T00:30:00+03:00');
    expect(cinemaDateOf(startsAt)).toBe('2026-10-16');
  });

  it('treats 05:59 as after midnight and 06:00 as the same day', () => {
    expect(iso(startInstantFor('2026-10-16', '05:59'))).toBe('2026-10-17T05:59:00+03:00');
    expect(iso(startInstantFor('2026-10-16', '06:00'))).toBe('2026-10-16T06:00:00+03:00');
  });

  it('refuses a start the clocks skip, naming the calendar date, the time and the cinema date', () => {
    const error = caught(() => startInstantFor('2026-04-23', '00:30'));
    expect(error.code).toBe('TIME_DOES_NOT_EXIST');
    expect(error.details).toEqual({ date: '2026-04-24', time: '00:30', cinemaDate: '2026-04-23' });
    expect(startInstantOrNull('2026-04-23', '00:30')).toBeNull();
    expect(iso(startInstantOrNull('2026-04-23', '01:00'))).toBe('2026-04-24T01:00:00+03:00');
  });

  it('takes the first occurrence of a time that happens twice', () => {
    expect(iso(startInstantFor('2026-10-29', '23:30'))).toBe('2026-10-29T23:30:00+03:00');
  });
});

describe('showtimeSpan', () => {
  it('ends after the runtime and is clean 20 minutes later', () => {
    const span = showtimeSpan(at('2026-10-16T19:30:00+03:00'), 128);
    expect([iso(span.startsAt), iso(span.endsAt), iso(span.cleaningEndsAt)]).toEqual([
      '2026-10-16T19:30:00+03:00',
      '2026-10-16T21:38:00+03:00',
      '2026-10-16T21:58:00+03:00',
    ]);
  });

  it('keeps the real runtime across the spring-forward gap', () => {
    const span = showtimeSpan(startInstantFor('2026-04-23', '23:30'), 120);
    // 120 real minutes after 23:30 winter time is 02:30 summer time.
    expect(iso(span.endsAt)).toBe('2026-04-24T02:30:00+03:00');
    expect(span.endsAt.getTime() - span.startsAt.getTime()).toBe(120 * 60_000);
  });

  it('refuses a runtime that is not a positive whole number', () => {
    expect(caught(() => showtimeSpan(at('2026-10-16T19:30:00+03:00'), 0)).code).toBe('INTERNAL');
    expect(caught(() => showtimeSpan(at('2026-10-16T19:30:00+03:00'), 1.5)).code).toBe('INTERNAL');
  });
});

describe('fitsWindow', () => {
  it('fits a showtime that starts at opening or ends exactly at closing', () => {
    expect(fitsWindow(showtimeSpan(at('2026-10-16T12:00:00+03:00'), 120), WINDOW)).toBe(true);
    expect(fitsWindow(showtimeSpan(at('2026-10-16T23:00:00+03:00'), 120), WINDOW)).toBe(true);
  });

  it('refuses one minute over either edge, and a closed date', () => {
    expect(fitsWindow(showtimeSpan(at('2026-10-16T11:59:00+03:00'), 120), WINDOW)).toBe(false);
    expect(fitsWindow(showtimeSpan(at('2026-10-16T23:01:00+03:00'), 120), WINDOW)).toBe(false);
    expect(fitsWindow(showtimeSpan(at('2026-10-16T19:00:00+03:00'), 120), null)).toBe(false);
  });
});

describe('overlaps', () => {
  // Ends 21:30, clean at 21:50.
  const previous = busy(1, '2026-10-16T19:30:00+03:00', 120);

  it('finds a start 19 minutes after the end, but not 20 or 21', () => {
    for (const [minutes, expected] of [
      [19, [1]],
      [20, []],
      [21, []],
    ] as const) {
      const span = showtimeSpan(new Date(previous.endsAt.getTime() + minutes * 60_000), 90);
      expect({ minutes, ids: overlaps(span, [previous]).map((slot) => slot.id) }).toEqual({
        minutes,
        ids: expected,
      });
    }
  });

  it('finds a showtime whose cleaning runs into the next one', () => {
    // 17:10 + 120 ends at 19:10, clean at 19:30: touching. 17:11 is a minute into it.
    expect(overlaps(showtimeSpan(at('2026-10-16T17:10:00+03:00'), 120), [previous])).toEqual([]);
    expect(overlaps(showtimeSpan(at('2026-10-16T17:11:00+03:00'), 120), [previous])).toEqual([
      previous,
    ]);
  });
});

describe('suggestStarts', () => {
  const base = {
    cinemaDate: '2026-10-16',
    runtimeMinutes: 120,
    window: WINDOW,
    now: at('2026-10-10T10:00:00+03:00'),
  };

  it('offers up to three free starts on the 5-minute grid, nearest first, earlier on a tie', () => {
    // Busy 15:00–17:00 (clean 17:20) and 19:30–21:30 (clean 21:50).
    const slots = [
      busy(1, '2026-10-16T15:00:00+03:00', 120),
      busy(2, '2026-10-16T19:30:00+03:00', 120),
    ];
    const suggestions = suggestStarts({ ...base, requestedTime: '18:00', busy: slots });
    // No 2-hour show fits between them (17:20 + 140 minutes is past 19:30). The free starts are
    // 12:00–12:40 and 21:50–23:00; 21:50 is the nearest to 18:00.
    for (const suggestion of suggestions) {
      expect(suggestion.startTime).toMatch(/^\d{2}:[0-5][05]$/);
      const span = showtimeSpan(suggestion.startsAt, 120);
      expect(fitsWindow(span, WINDOW)).toBe(true);
      expect(overlaps(span, slots)).toEqual([]);
    }
    expect(suggestions).toHaveLength(3);
    expect(suggestions.map((item) => item.startTime)).toEqual(['21:50', '21:55', '22:00']);
  });

  it('breaks a tie towards the earlier start', () => {
    // Free everywhere: 13:05 itself, then 13:00 and 13:10, both 5 minutes away.
    const suggestions = suggestStarts({
      ...base,
      requestedTime: '13:05',
      busy: [],
      runtimeMinutes: 60,
    });
    expect(suggestions.map((item) => item.startTime)).toEqual(['13:05', '13:00', '13:10']);
  });

  it('skips starts the clocks skip, and starts not after now', () => {
    const april = suggestStarts({
      cinemaDate: '2026-04-23',
      requestedTime: '00:30',
      runtimeMinutes: 60,
      window: {
        opensAt: at('2026-04-23T12:00:00+02:00'),
        closesAt: at('2026-04-24T04:00:00+03:00'),
      },
      busy: [],
      now: at('2026-04-01T10:00:00+02:00'),
    });
    // 23:55 and 01:05 are both 35 minutes from 00:30: the earlier comes first.
    expect(april.map((item) => item.startTime)).toEqual(['01:00', '23:55', '01:05']);
    const late = suggestStarts({
      ...base,
      requestedTime: '12:00',
      busy: [],
      now: at('2026-10-16T22:57:00+03:00'),
    });
    expect(late.map((item) => item.startTime)).toEqual(['23:00']);
  });

  it('suggests nothing for a closed date or a full one', () => {
    expect(suggestStarts({ ...base, requestedTime: '19:30', busy: [], window: null })).toEqual([]);
    const full = [
      busy(1, '2026-10-16T12:00:00+03:00', 600),
      busy(2, '2026-10-16T22:20:00+03:00', 150),
    ];
    expect(suggestStarts({ ...base, requestedTime: '19:30', busy: full })).toEqual([]);
  });
});

describe('fromPrice', () => {
  const prices = {
    front: money(15000),
    middle: money(19000),
    back: money(23000),
  };

  it('is the cheapest zone the layout has seats in', () => {
    expect(fromPrice(prices, { front: 48, middle: 80, back: 64 })).toEqual(money(15000));
    expect(fromPrice(prices, { front: 0, middle: 80, back: 64 })).toEqual(money(19000));
    expect(fromPrice({ ...prices, back: money(9000) }, { front: 10, middle: 0, back: 0 })).toEqual(
      money(15000),
    );
  });
});
