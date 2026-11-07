import type { AuditReadRepository } from '../../../../src/common/audit/audit-read.repository';
import { AuditReadService } from '../../../../src/common/audit/audit-read.service';
import type { BookingEventsFilter } from '../../../../src/common/audit/types';

const AT = new Date('2026-10-15T11:02:10.123Z');
const FILTER: BookingEventsFilter = {
  bookingId: 12,
  bookingActions: ['booking.held'],
  showtime: { id: 81, actions: ['showtime.moved'], from: AT, until: null },
};
const PAGE = { after: { sortKey: AT.toISOString(), id: 3 }, limit: 5 };

describe('AuditReadService', () => {
  it('passes the filter and page through and returns the rows (when and what only) with the total', async () => {
    const repository = {
      bookingEvents: jest
        .fn()
        .mockResolvedValue([{ id: 4, occurred_at: AT, action: 'booking.held' }]),
      countBookingEvents: jest.fn().mockResolvedValue(7),
    };
    const service = new AuditReadService(repository as unknown as AuditReadRepository);

    await expect(service.bookingEvents(FILTER, PAGE)).resolves.toEqual({
      rows: [{ id: 4, occurredAt: AT, action: 'booking.held' }],
      total: 7,
    });
    expect(repository.bookingEvents).toHaveBeenCalledWith(FILTER, PAGE);
    expect(repository.countBookingEvents).toHaveBeenCalledWith(FILTER);
  });
});
