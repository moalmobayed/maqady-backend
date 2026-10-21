import type { TransactionContext } from '../../../../src/common/database/transaction-context';
import { AppError } from '../../../../src/common/errors/app-error';
import type { SeatClaimsRepository } from '../../../../src/modules/seating/seat-claims.repository';
import { SeatClaimService } from '../../../../src/modules/seating/seat-claim.service';

const NOW = new Date('2026-10-16T19:00:00+03:00');
const UNTIL = new Date('2026-10-16T19:05:00+03:00');

describe('SeatClaimService', () => {
  const upsert = jest.fn();
  const claims = { upsert } as unknown as SeatClaimsRepository;
  const active = { isActive: () => true } as unknown as TransactionContext;

  it('runs one statement per showtime in id order and splits claimed from missing', async () => {
    upsert.mockImplementation((statement: { showtimeId: number }) =>
      Promise.resolve(
        statement.showtimeId === 7
          ? [
              { seat_label: 'A1', booking_id: 50 },
              { seat_label: 'B1', booking_id: 49 },
            ]
          : [{ seat_label: 'C1', booking_id: 48 }],
      ),
    );
    const outcome = await new SeatClaimService(claims, active).write({
      now: NOW,
      claim: { showtimeId: 7, bookingId: 50, labels: ['A2', 'A1'], claimedUntil: UNTIL },
      release: [
        { showtimeId: 9, bookingId: 48, labels: ['C1'] },
        { showtimeId: 7, bookingId: 49, labels: ['B1'] },
      ],
    });
    const statements = upsert.mock.calls as [{ showtimeId: number }, Date][];
    expect(statements.map(([statement]) => statement.showtimeId)).toEqual([7, 9]);
    expect(statements.every(([, now]) => now === NOW)).toBe(true);
    expect(outcome).toEqual({ claimed: ['A1'], missing: ['A2'] });
  });

  it('answers a release-only plan with nothing claimed or missing', async () => {
    upsert.mockResolvedValue([]);
    await expect(
      new SeatClaimService(claims, active).write({
        now: NOW,
        release: [{ showtimeId: 3, bookingId: 1, labels: ['A1'] }],
      }),
    ).resolves.toEqual({ claimed: [], missing: [] });
  });

  it('refuses to write outside a transaction', async () => {
    const inactive = { isActive: () => false } as unknown as TransactionContext;
    await expect(
      new SeatClaimService(claims, inactive).write({ now: NOW, release: [] }),
    ).rejects.toEqual(new AppError('INTERNAL', 'Seat claims are written inside a transaction.'));
    expect(upsert).not.toHaveBeenCalled();
  });
});
