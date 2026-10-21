import { formatCairoIso } from '../../../../src/common/time/time';
import type { CalendarDate, IsoWeekday } from '../../../../src/common/time/types';
import {
  closesMinuteOf,
  hoursProblems,
  mergeHours,
  openingMinuteToWallClock,
  opensMinuteOf,
  openStateAt,
  openStateDates,
  resolveCinemaDateHours,
  toHoursSpec,
  windowOf,
} from '../../../../src/modules/theaters/opening-hours';
import type {
  CinemaDateHours,
  DayHours,
  OpenState,
  SpecialDate,
} from '../../../../src/modules/theaters/types';
import { cinemaDatesBetween } from '../../../../src/modules/theaters/opening-hours';

/** Weekly hours: the same opening every weekday, or closed. */
function everyDay(opens: string | null, closes: string | null): DayHours[] {
  return ([1, 2, 3, 4, 5, 6, 7] as IsoWeekday[]).map((weekday) => ({
    weekday,
    ...(opens === null || closes === null
      ? { closed: true, opensMinute: null, closesMinute: null }
      : { closed: false, opensMinute: opensMinuteOf(opens), closesMinute: closesMinuteOf(closes) }),
  }));
}

function special(
  cinemaDate: CalendarDate,
  opens: string | null,
  closes: string | null,
  label = 'Holiday',
): SpecialDate {
  return {
    id: 1,
    theaterId: 1,
    cinemaDate,
    label,
    closed: opens === null,
    opensMinute: opens === null ? null : opensMinuteOf(opens),
    closesMinute: closes === null ? null : closesMinuteOf(closes),
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

/** The hours of every cinema date an open state at `at` looks at. */
function daysFor(at: Date, weekly: DayHours[], specials: SpecialDate[] = []): CinemaDateHours[] {
  const { from, to } = openStateDates(at);
  return cinemaDatesBetween(from, to).map((date) => resolveCinemaDateHours(date, weekly, specials));
}

/** An open state with its instants written as the API writes them. */
function stateAt(at: string, weekly: DayHours[], specials: SpecialDate[] = []) {
  const instant = new Date(at);
  return written(openStateAt(instant, daysFor(instant, weekly, specials)));
}

function written(state: OpenState) {
  return {
    isOpen: state.isOpen,
    closesAt: state.closesAt ? formatCairoIso(state.closesAt) : null,
    nextOpensAt: state.nextOpensAt ? formatCairoIso(state.nextOpensAt) : null,
  };
}

const open = (closesAt: string) => ({ isOpen: true, closesAt, nextOpensAt: null });
const closed = (nextOpensAt: string | null) => ({ isOpen: false, closesAt: null, nextOpensAt });

// 2026-10-14 is a Wednesday, 2026-10-15 a Thursday.
describe('opening minutes', () => {
  it('accepts an opening from 06:00 to 23:59 only', () => {
    expect(opensMinuteOf('05:59')).toBeNull();
    expect(opensMinuteOf('06:00')).toBe(360);
    expect(opensMinuteOf('12:00')).toBe(720);
    expect(opensMinuteOf('23:59')).toBe(1439);
    expect(opensMinuteOf('24:00')).toBeNull();
    expect(opensMinuteOf('9:00')).toBeNull();
  });

  it('puts a closing at or before 06:00 on the next calendar day', () => {
    expect(closesMinuteOf('00:00')).toBe(1440);
    expect(closesMinuteOf('01:00')).toBe(1500);
    expect(closesMinuteOf('06:00')).toBe(1800);
    expect(closesMinuteOf('06:01')).toBe(361);
    expect(closesMinuteOf('23:30')).toBe(1410);
  });

  it('turns stored minutes back into the times the admin typed', () => {
    expect(openingMinuteToWallClock(720)).toEqual({ time: '12:00', nextDay: false });
    expect(openingMinuteToWallClock(1439)).toEqual({ time: '23:59', nextDay: false });
    expect(openingMinuteToWallClock(1440)).toEqual({ time: '00:00', nextDay: true });
    expect(openingMinuteToWallClock(1500)).toEqual({ time: '01:00', nextDay: true });
    expect(openingMinuteToWallClock(1800)).toEqual({ time: '06:00', nextDay: true });
    for (const time of ['06:00', '12:30', '23:59']) {
      expect(openingMinuteToWallClock(opensMinuteOf(time)!).time).toBe(time);
    }
    expect(() => openingMinuteToWallClock(1801)).toThrow();
  });
});

describe('hoursProblems', () => {
  it('accepts an opening that closes after midnight, up to 06:00', () => {
    expect(hoursProblems({ closed: false, opens: '12:00', closes: '01:00' })).toEqual([]);
    expect(hoursProblems({ closed: false, opens: '10:00', closes: '06:00' })).toEqual([]);
    expect(hoursProblems({ closed: false, opens: '06:00', closes: '23:59' })).toEqual([]);
    expect(hoursProblems({ closed: true })).toEqual([]);
  });

  it('refuses a closing that is not after the opening', () => {
    for (const [opens, closes] of [
      ['12:00', '11:00'],
      ['12:00', '12:00'],
      ['22:00', '21:00'],
      ['10:00', '06:01'],
    ] as const) {
      expect(hoursProblems({ closed: false, opens, closes }, 'days.2.')).toEqual([
        { field: 'days.2.closes', messages: [expect.stringContaining('after opens')] },
      ]);
    }
  });

  it('refuses an opening before 06:00, which belongs to the previous cinema date', () => {
    expect(hoursProblems({ closed: false, opens: '05:59', closes: '12:00' })).toEqual([
      { field: 'opens', messages: [expect.stringContaining('06:00 to 23:59')] },
    ]);
  });

  it('refuses times on a closed day and missing times on an open one', () => {
    expect(hoursProblems({ closed: true, opens: '12:00', closes: '01:00' })).toEqual([
      { field: 'opens', messages: ['leave out opens and closes on a closed day'] },
      { field: 'closes', messages: ['leave out opens and closes on a closed day'] },
    ]);
    expect(hoursProblems({ closed: false, opens: '12:00' })).toEqual([
      { field: 'closes', messages: ['opens and closes are required on an open day'] },
    ]);
  });

  it('converts valid hours to stored minutes, and refuses to convert invalid ones', () => {
    expect(toHoursSpec({ closed: false, opens: '12:00', closes: '01:00' })).toEqual({
      closed: false,
      opensMinute: 720,
      closesMinute: 1500,
    });
    expect(toHoursSpec({ closed: true })).toEqual({
      closed: true,
      opensMinute: null,
      closesMinute: null,
    });
    expect(() => toHoursSpec({ closed: false, opens: '12:00', closes: '11:00' })).toThrow();
  });
});

describe('mergeHours (PATCH of a special date)', () => {
  const stored = { closed: false, opensMinute: 600, closesMinute: 1620 }; // 10:00–03:00

  it('keeps the stored minute of a time left out', () => {
    expect(mergeHours(stored, { closes: '02:00' })).toEqual({
      hours: { closed: false, opensMinute: 600, closesMinute: 1560 },
      problems: [],
    });
  });

  it('closes the day and refuses times sent with closed: true', () => {
    expect(mergeHours(stored, { closed: true }).hours).toEqual({
      closed: true,
      opensMinute: null,
      closesMinute: null,
    });
    expect(mergeHours(stored, { closed: true, opens: '11:00' }).problems).toEqual([
      { field: 'opens', messages: ['leave out opens and closes on a closed day'] },
    ]);
  });

  it('needs both times to open a closed day', () => {
    const closedDay = { closed: true, opensMinute: null, closesMinute: null };
    expect(mergeHours(closedDay, { closed: false, opens: '11:00' }).problems).toEqual([
      { field: 'closes', messages: ['opens and closes are required on an open day'] },
    ]);
    expect(mergeHours(closedDay, { closed: false, opens: '11:00', closes: '23:00' })).toEqual({
      hours: { closed: false, opensMinute: 660, closesMinute: 1380 },
      problems: [],
    });
  });

  it('checks the merged result as a whole', () => {
    expect(mergeHours(stored, { opens: '23:00', closes: '22:00' }).problems).toEqual([
      { field: 'closes', messages: [expect.stringContaining('after opens')] },
    ]);
    expect(mergeHours(stored, { opens: '05:00' }).problems).toEqual([
      { field: 'opens', messages: [expect.stringContaining('06:00 to 23:59')] },
    ]);
  });
});

describe('resolveCinemaDateHours', () => {
  const weekly = everyDay('12:00', '01:00');

  it("uses the weekday's hours, by the weekday of the cinema date", () => {
    const hours = resolveCinemaDateHours('2026-10-14', weekly, []);
    expect(hours).toEqual(
      expect.objectContaining({ weekday: 3, source: 'weekly', specialDateLabel: null }),
    );
    expect(formatCairoIso(hours.window!.opensAt)).toBe('2026-10-14T12:00:00+03:00');
    expect(formatCairoIso(hours.window!.closesAt)).toBe('2026-10-15T01:00:00+03:00');
  });

  it("replaces the weekday's hours with the special date's", () => {
    const hours = resolveCinemaDateHours('2026-10-06', weekly, [
      special('2026-10-06', '10:00', '03:00', 'Armed Forces Day'),
    ]);
    expect(hours.source).toBe('special');
    expect(hours.specialDateLabel).toBe('Armed Forces Day');
    expect(formatCairoIso(hours.window!.opensAt)).toBe('2026-10-06T10:00:00+03:00');
    expect(formatCairoIso(hours.window!.closesAt)).toBe('2026-10-07T03:00:00+03:00');
  });

  it('has no window on a closed special date, a closed weekday, or without hours', () => {
    const closedSpecial = resolveCinemaDateHours('2026-10-14', weekly, [
      special('2026-10-14', null, null),
    ]);
    expect(closedSpecial).toEqual(
      expect.objectContaining({ source: 'special', window: null, hours: expect.anything() }),
    );
    expect(resolveCinemaDateHours('2026-10-14', everyDay(null, null), []).window).toBeNull();
    expect(resolveCinemaDateHours('2026-10-14', [], [])).toEqual(
      expect.objectContaining({ source: 'none', hours: null, window: null }),
    );
    expect(windowOf('2026-10-14', null)).toBeNull();
  });
});

describe('openStateAt on a normal day (12:00 to 01:00 every day)', () => {
  const weekly = everyDay('12:00', '01:00');

  it('is closed before opening, with the opening today', () => {
    expect(stateAt('2026-10-14T11:00:00+03:00', weekly)).toEqual(
      closed('2026-10-14T12:00:00+03:00'),
    );
  });

  it('is open in the evening, closing at 01:00 the next calendar day', () => {
    expect(stateAt('2026-10-14T20:00:00+03:00', weekly)).toEqual(open('2026-10-15T01:00:00+03:00'));
    expect(stateAt('2026-10-14T12:00:00+03:00', weekly).isOpen).toBe(true);
    expect(stateAt('2026-10-15T00:59:00+03:00', weekly).isOpen).toBe(true);
  });

  it("is closed from the closing time on, until the next cinema date's opening", () => {
    expect(stateAt('2026-10-15T01:00:00+03:00', weekly)).toEqual(
      closed('2026-10-15T12:00:00+03:00'),
    );
  });

  it("judges 01:30 on Thursday by Wednesday's hours (PRD C4)", () => {
    const wednesdayLate = weekly.map((day) =>
      day.weekday === 3 ? { ...day, closesMinute: closesMinuteOf('02:00') } : day,
    );
    expect(stateAt('2026-10-15T01:30:00+03:00', wednesdayLate)).toEqual(
      open('2026-10-15T02:00:00+03:00'),
    );
    expect(stateAt('2026-10-15T01:30:00+03:00', weekly)).toEqual(
      closed('2026-10-15T12:00:00+03:00'),
    );
  });

  it('skips a closed special date tomorrow to the day after', () => {
    expect(
      stateAt('2026-10-14T02:00:00+03:00', weekly, [special('2026-10-14', null, null)]),
    ).toEqual(closed('2026-10-15T12:00:00+03:00'));
  });

  it("uses a special date's changed hours", () => {
    const specials = [special('2026-10-14', '11:00', '03:00')];
    expect(stateAt('2026-10-14T11:30:00+03:00', weekly, specials)).toEqual(
      open('2026-10-15T03:00:00+03:00'),
    );
    expect(stateAt('2026-10-15T02:30:00+03:00', weekly, specials).isOpen).toBe(true);
  });

  it('has no next opening when every day is closed', () => {
    expect(stateAt('2026-10-14T20:00:00+03:00', everyDay(null, null))).toEqual(closed(null));
    expect(stateAt('2026-10-14T20:00:00+03:00', [])).toEqual(closed(null));
  });

  it('looks 7 cinema dates ahead, not 8', () => {
    const onlyOn = (weekday: IsoWeekday) =>
      everyDay(null, null).map((day) =>
        day.weekday === weekday
          ? { ...day, closed: false, opensMinute: 720, closesMinute: 1500 }
          : day,
      );
    // 02:00 on Thursday is still Wednesday's cinema date, after closing: next Wednesday is 7 ahead.
    expect(stateAt('2026-10-15T02:00:00+03:00', onlyOn(3))).toEqual(
      closed('2026-10-21T12:00:00+03:00'),
    );
    // A special date 8 cinema dates ahead is too far.
    const farOnly = [special('2026-10-22', '12:00', '23:00')];
    expect(stateAt('2026-10-14T20:00:00+03:00', everyDay(null, null), farOnly)).toEqual(
      closed(null),
    );
    expect(
      stateAt('2026-10-14T20:00:00+03:00', everyDay(null, null), [
        special('2026-10-21', '12:00', '23:00'),
      ]),
    ).toEqual(closed('2026-10-21T12:00:00+03:00'));
  });
});

describe('openStateAt on the 2026 summer-time days', () => {
  it('moves a closing in the skipped hour (24 April, 00:00–00:59) to 01:00 summer time', () => {
    const weekly = everyDay('12:00', '00:30');
    expect(stateAt('2026-04-23T23:50:00+02:00', weekly)).toEqual(open('2026-04-24T01:00:00+03:00'));
    expect(stateAt('2026-04-24T01:00:00+03:00', weekly)).toEqual(
      closed('2026-04-24T12:00:00+03:00'),
    );
  });

  it('puts 06:30 on 24 April in that cinema date, opening at 12:00 summer time', () => {
    expect(stateAt('2026-04-24T06:30:00+03:00', everyDay('12:00', '01:00'))).toEqual(
      closed('2026-04-24T12:00:00+03:00'),
    );
  });

  it('closes at the first 23:30 of 29 October, the hour that happens twice', () => {
    const weekly = everyDay('12:00', '23:30');
    expect(stateAt('2026-10-29T23:00:00+03:00', weekly)).toEqual(open('2026-10-29T23:30:00+03:00'));
    // The second 23:45 of the night, in winter time: already closed.
    expect(stateAt('2026-10-29T23:45:00+02:00', weekly)).toEqual(
      closed('2026-10-30T12:00:00+02:00'),
    );
  });

  it('keeps a closing after midnight on 29 October in winter time, an hour longer open', () => {
    const weekly = everyDay('12:00', '01:00');
    expect(stateAt('2026-10-29T12:00:00+03:00', weekly)).toEqual(open('2026-10-30T01:00:00+02:00'));
    expect(stateAt('2026-10-29T23:30:00+02:00', weekly).isOpen).toBe(true);
    const window = resolveCinemaDateHours('2026-10-29', weekly, []).window!;
    expect(formatCairoIso(window.opensAt)).toBe('2026-10-29T12:00:00+03:00');
    expect(window.closesAt.toISOString()).toBe('2026-10-29T23:00:00.000Z');
  });
});
