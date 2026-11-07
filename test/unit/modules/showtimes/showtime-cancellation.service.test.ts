import { RegisteredShowtimeCancellation } from '../../../../src/modules/showtimes/showtime-cancellation.service';
import type { ShowtimeCancellationInput } from '../../../../src/modules/showtimes/types';

const INPUT = {
  showtime: { id: 81 },
  reason: 'technical_issue',
  actor: { kind: 'staff', id: 3, sessionId: 30, role: 'admin' },
} as unknown as ShowtimeCancellationInput;

describe('RegisteredShowtimeCancellation', () => {
  it('refuses to cancel before bookings registered, and a second registration', async () => {
    const registry = new RegisteredShowtimeCancellation();
    await expect(registry.cancelBookings(INPUT)).rejects.toMatchObject({ code: 'INTERNAL' });
    const implementation = {
      cancelBookings: jest
        .fn()
        .mockResolvedValue({ refundedBookingCount: 1, releasedHoldCount: 0, notifiedCount: 1 }),
    };
    registry.register(implementation);
    expect(() => registry.register(implementation)).toThrow(
      expect.objectContaining({ code: 'INTERNAL' }),
    );
    expect(await registry.cancelBookings(INPUT)).toEqual({
      refundedBookingCount: 1,
      releasedHoldCount: 0,
      notifiedCount: 1,
    });
    expect(implementation.cancelBookings).toHaveBeenCalledWith(INPUT);
  });
});
