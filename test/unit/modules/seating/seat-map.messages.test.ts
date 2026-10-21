import {
  errorMessage,
  eventMessage,
  parseShowtimeId,
  snapshotMessage,
} from '../../../../src/modules/seating/seat-map.messages';

describe('seat map messages', () => {
  it.each([
    [{ showtimeId: 0 }],
    [{ showtimeId: -1 }],
    [{ showtimeId: 1.5 }],
    [{ showtimeId: '7' }],
    [{ showtimeId: 2 ** 53 }],
    [{}],
    [null],
    ['7'],
    [7],
  ])('refuses %j as a showtime id', (data) => {
    expect(parseShowtimeId(data)).toBeNull();
  });

  it('accepts a positive safe integer', () => {
    expect(parseShowtimeId({ showtimeId: 81 })).toBe(81);
    expect(parseShowtimeId({ showtimeId: Number.MAX_SAFE_INTEGER })).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('writes a snapshot with heldUntil only on held seats, in Cairo time (summer and winter)', () => {
    expect(
      snapshotMessage({
        showtimeId: 81,
        serverTime: new Date('2026-10-16T16:00:00Z'),
        seats: [
          { label: 'A1', state: 'booked', heldUntil: null },
          { label: 'F7', state: 'held', heldUntil: new Date('2026-10-16T16:05:00Z') },
        ],
      }),
    ).toEqual({
      event: 'snapshot',
      data: {
        showtimeId: 81,
        serverTime: '2026-10-16T19:00:00+03:00',
        seats: [
          { label: 'A1', state: 'booked' },
          { label: 'F7', state: 'held', heldUntil: '2026-10-16T19:05:00+03:00' },
        ],
      },
    });
    const winter = eventMessage({
      type: 'seat.held',
      showtimeId: 3,
      labels: ['B2'],
      heldUntil: new Date('2026-12-01T10:05:00Z'),
    });
    expect(winter).toEqual({
      event: 'seat.held',
      data: { showtimeId: 3, labels: ['B2'], heldUntil: '2026-12-01T12:05:00+02:00' },
    });
  });

  it('writes released and booked events with labels only, and errors with a code', () => {
    expect(eventMessage({ type: 'seat.released', showtimeId: 3, labels: ['B2', 'B3'] })).toEqual({
      event: 'seat.released',
      data: { showtimeId: 3, labels: ['B2', 'B3'] },
    });
    expect(eventMessage({ type: 'seat.booked', showtimeId: 3, labels: ['C1'] })).toEqual({
      event: 'seat.booked',
      data: { showtimeId: 3, labels: ['C1'] },
    });
    expect(errorMessage('RATE_LIMITED')).toEqual({
      event: 'error',
      data: { code: 'RATE_LIMITED' },
    });
  });
});
