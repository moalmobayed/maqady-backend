import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { SeatEventBus } from '../../../../src/modules/seating/seat-event.bus';
import { SeatEventPublisher } from '../../../../src/modules/seating/seat-event.publisher';
import type { SeatEvent } from '../../../../src/modules/seating/types';

const RELEASED: SeatEvent = { type: 'seat.released', showtimeId: 7, labels: ['A1'] };

describe('seat events', () => {
  it('fans an event out to every listener, a throwing one not stopping the others', () => {
    const bus = new SeatEventBus();
    const received: SeatEvent[] = [];
    bus.subscribe(() => {
      throw new Error('listener down');
    });
    const unsubscribe = bus.subscribe((event) => received.push(event));
    bus.publish(RELEASED);
    unsubscribe();
    bus.publish(RELEASED);
    expect(received).toEqual([RELEASED]);
  });

  it('publishes only through a post-commit hook, and nothing for no seats', async () => {
    const bus = new SeatEventBus();
    const publish = jest.spyOn(bus, 'publish');
    const hooks: (() => void | Promise<void>)[] = [];
    const transactions = {
      afterCommit: jest.fn((hook: () => void) => {
        hooks.push(hook);
        return Promise.resolve();
      }),
    } as unknown as TransactionRepository;
    const publisher = new SeatEventPublisher(bus, transactions);

    await publisher.publishAfterCommit(RELEASED);
    await publisher.publishAfterCommit({ type: 'seat.released', showtimeId: 7, labels: [] });
    expect(publish).not.toHaveBeenCalled();
    expect(hooks).toHaveLength(1);
    await hooks[0]!();
    expect(publish).toHaveBeenCalledWith(RELEASED);
  });
});
