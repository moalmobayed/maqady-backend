import {
  claimStatements,
  compareSeatLabels,
  sortedLabels,
} from '../../../../src/modules/seating/claim-plan';

const NOW = new Date('2026-10-16T19:00:00+03:00');
const UNTIL = new Date('2026-10-16T19:05:00+03:00');

describe('claim plan', () => {
  it('sorts labels in code-point order, each once', () => {
    expect(sortedLabels(['F8', 'A10', 'F7', 'A2', 'F7'])).toEqual(['A10', 'A2', 'F7', 'F8']);
    expect(compareSeatLabels('A10', 'A2')).toBeLessThan(0);
    expect(compareSeatLabels('B1', 'B1')).toBe(0);
  });

  it('writes a claim alone as one sorted statement with nothing to take over', () => {
    expect(
      claimStatements({
        now: NOW,
        claim: { showtimeId: 7, bookingId: 40, labels: ['C3', 'A1', 'B2'], claimedUntil: UNTIL },
        release: [],
      }),
    ).toEqual([
      {
        showtimeId: 7,
        rows: [
          { label: 'A1', bookingId: 40, claimedUntil: UNTIL },
          { label: 'B2', bookingId: 40, claimedUntil: UNTIL },
          { label: 'C3', bookingId: 40, claimedUntil: UNTIL },
        ],
        takeOverFrom: [],
      },
    ]);
  });

  it('folds a release of the same showtime into the claim, the new claim winning a shared label', () => {
    const [statement, ...rest] = claimStatements({
      now: NOW,
      claim: { showtimeId: 7, bookingId: 41, labels: ['F8', 'F9'], claimedUntil: UNTIL },
      release: [{ showtimeId: 7, bookingId: 40, labels: ['F7', 'F8'] }],
    });
    expect(rest).toEqual([]);
    expect(statement).toEqual({
      showtimeId: 7,
      rows: [
        { label: 'F7', bookingId: 40, claimedUntil: NOW },
        { label: 'F8', bookingId: 41, claimedUntil: UNTIL },
        { label: 'F9', bookingId: 41, claimedUntil: UNTIL },
      ],
      takeOverFrom: [40],
    });
  });

  it('writes other showtimes as release-only statements, all in showtime id order', () => {
    const statements = claimStatements({
      now: NOW,
      claim: { showtimeId: 7, bookingId: 50, labels: ['A1'], claimedUntil: UNTIL },
      release: [
        { showtimeId: 9, bookingId: 44, labels: ['B2', 'B1'] },
        { showtimeId: 3, bookingId: 45, labels: ['C1'] },
      ],
    });
    expect(statements.map((statement) => statement.showtimeId)).toEqual([3, 7, 9]);
    expect(statements[0]).toEqual({
      showtimeId: 3,
      rows: [{ label: 'C1', bookingId: 45, claimedUntil: NOW }],
      takeOverFrom: [45],
    });
    expect(statements[2]).toEqual({
      showtimeId: 9,
      rows: [
        { label: 'B1', bookingId: 44, claimedUntil: NOW },
        { label: 'B2', bookingId: 44, claimedUntil: NOW },
      ],
      takeOverFrom: [44],
    });
    expect(statements[1]?.takeOverFrom).toEqual([]);
  });

  it('keeps a sold claim (null) as null, and drops a release with no seats', () => {
    const statements = claimStatements({
      now: NOW,
      claim: { showtimeId: 2, bookingId: 60, labels: ['D4'], claimedUntil: null },
      release: [{ showtimeId: 5, bookingId: 61, labels: [] }],
    });
    expect(statements).toEqual([
      {
        showtimeId: 2,
        rows: [{ label: 'D4', bookingId: 60, claimedUntil: null }],
        takeOverFrom: [],
      },
    ]);
  });
});
