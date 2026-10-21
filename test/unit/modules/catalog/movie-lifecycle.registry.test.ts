import { AppError } from '../../../../src/common/errors/app-error';
import { MovieLifecycleRegistry } from '../../../../src/modules/catalog/movie-lifecycle.registry';

describe('MovieLifecycleRegistry', () => {
  it('reports the blockers that refuse a movie, in registration order', async () => {
    const registry = new MovieLifecycleRegistry();
    registry.addDeletionBlocker({
      key: 'has_showtimes',
      blocks: (id) => Promise.resolve(id === 1),
    });
    registry.addDeletionBlocker({ key: 'has_bookings', blocks: () => Promise.resolve(true) });

    expect(await registry.deletionBlockersOf(1)).toEqual(['has_showtimes', 'has_bookings']);
    expect(await registry.deletionBlockersOf(2)).toEqual(['has_bookings']);
  });

  it('blocks nothing until a blocker is registered', async () => {
    expect(await new MovieLifecycleRegistry().deletionBlockersOf(1)).toEqual([]);
  });

  it('refuses a second blocker with the same key', () => {
    const registry = new MovieLifecycleRegistry();
    registry.addDeletionBlocker({ key: 'has_bookings', blocks: () => Promise.resolve(false) });
    expect(() =>
      registry.addDeletionBlocker({ key: 'has_bookings', blocks: () => Promise.resolve(true) }),
    ).toThrow(AppError);
  });
});
