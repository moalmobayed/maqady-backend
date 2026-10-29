import { resolveException } from '../../../../src/common/errors/error-mapping';
import type { BookingsRepository } from '../../../../src/modules/bookings/bookings.repository';
import { TicketsService } from '../../../../src/modules/bookings/tickets.service';

describe('TicketsService.queueTickets', () => {
  it('sends to another address one booking at a time only, before reading anything', async () => {
    const bookings = { findByIds: jest.fn() };
    const service = new TicketsService(
      bookings as unknown as BookingsRepository,
      ...([{}, {}, {}, {}, {}, {}] as unknown as [never, never, never, never, never, never]),
    );
    const caught = await service
      .queueTickets([1, 2], { sms: false, emailTo: 'mona@example.com' })
      .catch((e: unknown) => e);
    expect(resolveException(caught)).toMatchObject({ status: 500, code: 'INTERNAL' });
    expect(bookings.findByIds).not.toHaveBeenCalled();
  });
});
