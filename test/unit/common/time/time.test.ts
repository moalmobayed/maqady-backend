import { AppError } from '../../../../src/common/errors/app-error';
import {
  addDays,
  addToInstant,
  cinemaDateOf,
  cinemaDayBounds,
  cairoWallClockOf,
  cinemaMinuteToInstant,
  formatCairoDisplay,
  formatCairoIso,
  isCalendarDate,
  isIsoInstant,
  startOfNextUtcDay,
  subtractFromInstant,
  wallClockToInstant,
  weekdayOfCinemaDate,
} from '../../../../src/common/time/time';

// Cairo 2026: summer time starts Friday 24 April at 00:00 (clocks jump to 01:00, UTC+3) and
// ends Thursday 29 October at 24:00 (clocks fall back to 23:00, UTC+2).
const at = (iso: string): Date => new Date(iso);

function caught(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

describe('cinemaDateOf', () => {
  it('puts a 00:30 show on the previous cinema date (2026-10-17 00:30 Cairo → 2026-10-16)', () => {
    expect(cinemaDateOf(at('2026-10-17T00:30:00+03:00'))).toBe('2026-10-16');
  });

  it('keeps 06:30 on the summer-time start day on that date (2026-04-24 06:30 → 2026-04-24)', () => {
    // Subtracting six hours would land on 23:30 Thursday winter time, the wrong date.
    expect(cinemaDateOf(at('2026-04-24T06:30:00+03:00'))).toBe('2026-04-24');
  });

  it.each([
    ['2026-10-16T05:59:59+03:00', '2026-10-15'],
    ['2026-10-16T06:00:00+03:00', '2026-10-16'],
    ['2026-10-16T23:59:00+03:00', '2026-10-16'],
    ['2026-04-24T01:30:00+03:00', '2026-04-23'],
    ['2026-01-01T03:00:00+02:00', '2025-12-31'],
    ['2026-10-30T05:59:00+02:00', '2026-10-29'],
  ])('%s belongs to %s, judged by the Cairo wall clock', (instant, date) => {
    expect(cinemaDateOf(at(instant))).toBe(date);
  });
});

describe('cinemaDayBounds', () => {
  it('runs from 06:00 on the date to 06:00 the next day', () => {
    expect(cinemaDayBounds('2026-10-16')).toEqual({
      startsAt: at('2026-10-16T06:00:00+03:00'),
      endsAt: at('2026-10-17T06:00:00+03:00'),
    });
  });

  it('is 23 hours long across the spring-forward night and 25 across the fall-back one', () => {
    const spring = cinemaDayBounds('2026-04-23');
    expect(spring.startsAt).toEqual(at('2026-04-23T06:00:00+02:00'));
    expect(spring.endsAt).toEqual(at('2026-04-24T06:00:00+03:00'));
    const autumn = cinemaDayBounds('2026-10-29');
    expect(autumn.startsAt).toEqual(at('2026-10-29T06:00:00+03:00'));
    expect(autumn.endsAt).toEqual(at('2026-10-30T06:00:00+02:00'));
  });
});

describe('weekdayOfCinemaDate', () => {
  it('numbers ISO weekdays, 1 = Monday to 7 = Sunday', () => {
    expect(weekdayOfCinemaDate('2026-10-19')).toBe(1);
    expect(weekdayOfCinemaDate('2026-10-16')).toBe(5);
    expect(weekdayOfCinemaDate('2026-10-18')).toBe(7);
  });

  it("gives a 00:30 show the previous date's weekday", () => {
    expect(weekdayOfCinemaDate(cinemaDateOf(at('2026-10-17T00:30:00+03:00')))).toBe(5);
  });
});

describe('wallClockToInstant (admin input)', () => {
  it('converts a Cairo wall-clock time with the offset of that date', () => {
    expect(wallClockToInstant('2026-10-16', '19:30')).toEqual(at('2026-10-16T19:30:00+03:00'));
    expect(wallClockToInstant('2026-01-10', '19:30')).toEqual(at('2026-01-10T19:30:00+02:00'));
  });

  it('refuses a time that does not exist on the spring-forward night with TIME_DOES_NOT_EXIST', () => {
    for (const time of ['00:00', '00:30', '00:59']) {
      const error = caught(() => wallClockToInstant('2026-04-24', time));
      expect(error.code).toBe('TIME_DOES_NOT_EXIST');
      expect(error.status).toBe(422);
      expect(error.details).toEqual({ date: '2026-04-24', time });
    }
    expect(wallClockToInstant('2026-04-24', '01:00')).toEqual(at('2026-04-24T01:00:00+03:00'));
    expect(wallClockToInstant('2026-04-23', '23:59')).toEqual(at('2026-04-23T23:59:00+02:00'));
  });

  it('resolves a time that occurs twice on the fall-back night to its first occurrence', () => {
    expect(wallClockToInstant('2026-10-29', '23:30')).toEqual(at('2026-10-29T23:30:00+03:00'));
  });

  it('refuses malformed input as a programming error', () => {
    expect(caught(() => wallClockToInstant('2026-10-16', '7:30')).code).toBe('INTERNAL');
    expect(caught(() => wallClockToInstant('2026-02-30', '07:30')).code).toBe('INTERNAL');
  });
});

describe('cinemaMinuteToInstant (stored opening hours)', () => {
  it('counts minutes from midnight at the start of the cinema date, past midnight included', () => {
    expect(cinemaMinuteToInstant('2026-10-16', 600)).toEqual(at('2026-10-16T10:00:00+03:00'));
    expect(cinemaMinuteToInstant('2026-10-16', 1500)).toEqual(at('2026-10-17T01:00:00+03:00'));
    expect(cinemaMinuteToInstant('2026-10-16', 1800)).toEqual(at('2026-10-17T06:00:00+03:00'));
  });

  it('shifts a minute in the skipped hour forward to the first valid time, never refusing it', () => {
    // 00:30 on 24 April does not exist; it was valid when the hours were entered.
    expect(cinemaMinuteToInstant('2026-04-23', 1470)).toEqual(at('2026-04-24T01:00:00+03:00'));
    expect(cinemaMinuteToInstant('2026-04-23', 1440)).toEqual(at('2026-04-24T01:00:00+03:00'));
    expect(cinemaMinuteToInstant('2026-04-23', 1500)).toEqual(at('2026-04-24T01:00:00+03:00'));
  });

  it('resolves a minute that occurs twice to its first occurrence', () => {
    expect(cinemaMinuteToInstant('2026-10-29', 1410)).toEqual(at('2026-10-29T23:30:00+03:00'));
  });

  it('refuses a minute outside 0 to 1800', () => {
    expect(caught(() => cinemaMinuteToInstant('2026-10-16', 1801)).code).toBe('INTERNAL');
    expect(caught(() => cinemaMinuteToInstant('2026-10-16', -1)).code).toBe('INTERNAL');
    expect(caught(() => cinemaMinuteToInstant('2026-10-16', 10.5)).code).toBe('INTERNAL');
  });
});

describe('formatCairoIso', () => {
  it('writes Cairo time with its offset and no milliseconds', () => {
    expect(formatCairoIso(at('2026-10-16T16:30:00.123Z'))).toBe('2026-10-16T19:30:00+03:00');
    expect(formatCairoIso(at('2026-01-10T17:30:00Z'))).toBe('2026-01-10T19:30:00+02:00');
  });
});

describe('formatCairoDisplay', () => {
  it('writes the Cairo wall clock with the weekday, in summer and in winter time', () => {
    expect(formatCairoDisplay(at('2026-10-16T16:30:00Z'))).toBe('Fri 16 Oct 2026, 19:30');
    expect(formatCairoDisplay(at('2026-01-10T17:30:00Z'))).toBe('Sat 10 Jan 2026, 19:30');
  });

  it('shows an after-midnight start on its own calendar day', () => {
    expect(formatCairoDisplay(at('2026-10-16T21:30:00Z'))).toBe('Sat 17 Oct 2026, 00:30');
  });
});

describe('cairoWallClockOf', () => {
  it('gives the Cairo time of day, HH:mm, whatever the offset', () => {
    expect(cairoWallClockOf(at('2026-10-16T16:30:00Z'))).toBe('19:30');
    expect(cairoWallClockOf(at('2026-10-16T21:30:00Z'))).toBe('00:30');
    expect(cairoWallClockOf(at('2026-01-10T17:05:00Z'))).toBe('19:05');
  });

  it('gives both occurrences of the fall-back hour the same wall clock', () => {
    expect(cairoWallClockOf(at('2026-10-29T20:30:00Z'))).toBe('23:30');
    expect(cairoWallClockOf(at('2026-10-29T21:30:00Z'))).toBe('23:30');
  });
});

describe('calendar and instant arithmetic', () => {
  it('adds days to a calendar date, across months and years', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('validates calendar dates', () => {
    expect(isCalendarDate('2026-10-16')).toBe(true);
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-1-5')).toBe(false);
  });

  it('recognises an instant written in ISO 8601 with its offset, and nothing looser', () => {
    expect(isIsoInstant('2026-10-16T19:30:00+03:00')).toBe(true);
    expect(isIsoInstant(new Date('2026-10-16T16:30:00Z').toISOString())).toBe(true);
    expect(isIsoInstant('2026-10-16')).toBe(false);
    expect(isIsoInstant('2026-10-16T19:30:00')).toBe(false);
    expect(isIsoInstant('2026-02-30T10:00:00Z')).toBe(false);
    expect(isIsoInstant('2026-W42-5')).toBe(false);
  });

  it('accepts only the offsets real time zones use (up to 14 hours either way)', () => {
    expect(isIsoInstant('2026-10-16T19:30:00+14:00')).toBe(true);
    expect(isIsoInstant('2026-10-16T19:30:00-12:00')).toBe(true);
    expect(isIsoInstant('2026-10-16T19:30:00+05:45')).toBe(true);
    for (const offset of ['+14:01', '-14:30', '+16:00', '+23:00', '+24:00', '+99:00', '+03:60']) {
      expect({ offset, valid: isIsoInstant(`2026-10-16T19:30:00${offset}`) }).toEqual({
        offset,
        valid: false,
      });
    }
  });

  it('adds and subtracts real durations, unaffected by summer time', () => {
    const before = at('2026-04-23T23:30:00+02:00');
    expect(addToInstant(before, { hours: 1 })).toEqual(at('2026-04-24T01:30:00+03:00'));
    expect(subtractFromInstant(at('2026-10-17T00:00:00Z'), { hours: 24 })).toEqual(
      at('2026-10-16T00:00:00Z'),
    );
  });
});

describe('startOfNextUtcDay (provider quota resets)', () => {
  it('is 00:00 UTC of the next UTC date, whatever the time in Cairo', () => {
    expect(startOfNextUtcDay(at('2026-10-20T09:15:00Z'))).toEqual(at('2026-10-21T00:00:00Z'));
    // 01:30 in Cairo on the 21st is still the 20th in UTC.
    expect(startOfNextUtcDay(at('2026-10-21T01:30:00+03:00'))).toEqual(at('2026-10-21T00:00:00Z'));
  });

  it('moves a refusal one second before midnight to that midnight', () => {
    expect(startOfNextUtcDay(at('2026-10-20T23:59:59.999Z'))).toEqual(at('2026-10-21T00:00:00Z'));
  });

  it('moves an instant exactly at midnight to the following midnight', () => {
    expect(startOfNextUtcDay(at('2026-10-21T00:00:00Z'))).toEqual(at('2026-10-22T00:00:00Z'));
  });

  it('crosses month and year ends', () => {
    expect(startOfNextUtcDay(at('2026-12-31T18:00:00Z'))).toEqual(at('2027-01-01T00:00:00Z'));
    expect(startOfNextUtcDay(at('2028-02-28T12:00:00Z'))).toEqual(at('2028-02-29T00:00:00Z'));
  });
});
