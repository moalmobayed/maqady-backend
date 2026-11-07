import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import type { CustomerBookingsRepository } from '../../../../src/modules/bookings/customer-bookings.repository';
import { CustomerBookingsService } from '../../../../src/modules/bookings/customer-bookings.service';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-20T10:00:00Z');

describe('CustomerBookingsService', () => {
  let repository: jest.Mocked<CustomerBookingsRepository>;
  let order: string[];
  let service: CustomerBookingsService;

  beforeEach(() => {
    order = [];
    repository = {
      statsOf: jest.fn().mockResolvedValue([
        {
          customer_id: 7,
          bookings: 3,
          spent: 57000,
          no_shows: 1,
          last_booking_at: new Date('2026-10-10T07:03:00Z'),
        },
      ]),
      lockIdsOfCustomer: jest.fn(() => {
        order.push('lock');
        return Promise.resolve([4, 9, 12]);
      }),
      clearContacts: jest.fn(() => {
        order.push('clear');
        return Promise.resolve(2);
      }),
    } as unknown as jest.Mocked<CustomerBookingsRepository>;
    const transactions = {
      run: jest.fn((fn: () => Promise<unknown>) => {
        order.push('begin');
        return fn();
      }),
    } as unknown as TransactionRepository;
    service = new CustomerBookingsService(repository, transactions, new TestClock(NOW));
  });

  it('reads the numbers of many customers in one query, giving zeros to those without bookings', async () => {
    const stats = await service.statsOf([7, 8, 7], NOW);
    expect(repository.statsOf).toHaveBeenCalledTimes(1);
    expect(repository.statsOf).toHaveBeenCalledWith([7, 8], NOW);
    expect(stats.get(7)).toEqual({
      customerId: 7,
      bookings: 3,
      spent: { amount: 57000, currency: 'EGP' },
      noShows: 1,
      lastBookingAt: new Date('2026-10-10T07:03:00Z'),
    });
    expect(stats.get(8)).toEqual({
      customerId: 8,
      bookings: 0,
      spent: { amount: 0, currency: 'EGP' },
      noShows: 0,
      lastBookingAt: null,
    });
  });

  it("locks the customer's bookings in id order before clearing their contacts", async () => {
    await expect(service.clearContactsOf(7)).resolves.toEqual({ bookings: 3, cleared: 2 });
    expect(order).toEqual(['begin', 'lock', 'clear']);
    expect(repository.lockIdsOfCustomer).toHaveBeenCalledWith(7);
    expect(repository.clearContacts).toHaveBeenCalledWith([4, 9, 12], NOW);
  });
});
