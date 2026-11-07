import { resolveException } from '../../../../src/common/errors/error-mapping';
import { encodeCursor } from '../../../../src/common/pagination/cursor';
import type { BookingViews } from '../../../../src/modules/bookings/booking-views.service';
import type { BookingsRepository } from '../../../../src/modules/bookings/bookings.repository';
import { MyBookingsService } from '../../../../src/modules/bookings/my-bookings.service';
import type { Booking, MyBookingRow } from '../../../../src/modules/bookings/types';
import { bookingRow } from '../../../support/booking-rows';
import { TestClock } from '../../../support/clock';
import { socketError } from '../../../support/errors';

const NOW = new Date('2026-10-16T19:00:00.000+03:00');

const row = (id: number, startsAt: string): MyBookingRow => ({
  ...bookingRow({ id, reference: `MQ-AAAAA${id}` }),
  showtime_starts_at: new Date(startsAt),
});
const booking = (id: number): Booking => ({ id, reference: `MQ-AAAAA${id}` }) as Booking;

describe('MyBookingsService', () => {
  let repository: { pageForCustomer: jest.Mock; tabCountsOfCustomer: jest.Mock };
  let views: { ofMany: jest.Mock };
  let clock: TestClock;
  let service: MyBookingsService;

  beforeEach(() => {
    repository = {
      pageForCustomer: jest.fn().mockResolvedValue([]),
      tabCountsOfCustomer: jest.fn().mockResolvedValue({ upcoming: 0, past: 0 }),
    };
    views = {
      ofMany: jest.fn((rows: MyBookingRow[]) => Promise.resolve(rows.map((r) => booking(r.id)))),
    };
    clock = new TestClock(NOW);
    jest.spyOn(clock, 'now');
    service = new MyBookingsService(
      repository as unknown as BookingsRepository,
      views as unknown as BookingViews,
      clock,
    );
  });

  it('reads the clock once and judges the page, the counts and the views at that instant', async () => {
    repository.pageForCustomer.mockResolvedValue([row(3, '2026-10-17T19:30:00+03:00')]);
    repository.tabCountsOfCustomer.mockResolvedValue({ upcoming: 1, past: 4 });

    const page = await service.list(12, { tab: 'upcoming' });

    expect(clock.now).toHaveBeenCalledTimes(1);
    expect(repository.pageForCustomer).toHaveBeenCalledWith(12, 'upcoming', NOW, {
      after: null,
      limit: 20,
    });
    expect(repository.tabCountsOfCustomer).toHaveBeenCalledWith(12, NOW);
    expect(views.ofMany).toHaveBeenCalledWith([expect.objectContaining({ id: 3 })], NOW);
    expect(page).toEqual({
      items: [booking(3)],
      nextCursor: null,
      total: 1,
      tabCounts: { upcoming: 1, past: 4 },
    });
  });

  it("takes the tab's own count as total and the next cursor from the last shown row, with milliseconds", async () => {
    repository.pageForCustomer.mockResolvedValue([
      row(5, '2026-10-12T21:00:00.250+03:00'),
      row(4, '2026-10-11T21:00:00+03:00'),
      row(2, '2026-10-10T21:00:00+03:00'),
    ]);
    repository.tabCountsOfCustomer.mockResolvedValue({ upcoming: 1, past: 9 });

    const page = await service.list(12, { tab: 'past', limit: 2 });

    expect(page.items.map((item) => item.id)).toEqual([5, 4]);
    expect(views.ofMany).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 5 }), expect.objectContaining({ id: 4 })],
      NOW,
    );
    expect(page.total).toBe(9);
    expect(page.nextCursor).toBe(encodeCursor({ sortKey: '2026-10-11T18:00:00.000Z', id: 4 }));
  });

  it('passes a cursor on as the keyset position', async () => {
    const cursor = encodeCursor({ sortKey: '2026-10-11T18:00:00.250Z', id: 4 });
    await service.list(12, { tab: 'past', cursor, limit: 5 });
    expect(repository.pageForCustomer).toHaveBeenCalledWith(12, 'past', NOW, {
      after: { sortKey: '2026-10-11T18:00:00.250Z', id: 4 },
      limit: 5,
    });
  });

  it.each([
    ['a text sort key', encodeCursor({ sortKey: 'Zamalek', id: 4 })],
    ['a number sort key', encodeCursor({ sortKey: 17, id: 4 })],
    ['a null sort key', encodeCursor({ sortKey: null, id: 4 })],
    ['garbage', 'bm90LWEtY3Vyc29y'],
  ])('refuses a cursor with %s before any query', async (_, cursor) => {
    const caught = await service.list(12, { tab: 'upcoming', cursor }).catch((e: unknown) => e);
    expect(resolveException(caught)).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    expect(repository.pageForCustomer).not.toHaveBeenCalled();
    expect(repository.tabCountsOfCustomer).not.toHaveBeenCalled();
  });

  it('lets a datastore outage through, which the filter answers with 503', async () => {
    repository.pageForCustomer.mockRejectedValue(socketError('ECONNREFUSED'));
    const caught = await service.list(12, { tab: 'upcoming' }).catch((e: unknown) => e);
    expect(resolveException(caught)).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
  });
});
