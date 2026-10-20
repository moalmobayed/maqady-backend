import { TheaterLifecycleRegistry } from '../../../../src/modules/theaters/theater-lifecycle.registry';

const requirement = (key: string) => ({ key, isMet: () => Promise.resolve(true) });
const blocker = (key: string) => ({ key, blocks: () => Promise.resolve(false) });

describe('TheaterLifecycleRegistry', () => {
  it('keeps publish requirements and deletion blockers in registration order', () => {
    const registry = new TheaterLifecycleRegistry();
    registry.addPublishRequirement(requirement('active_hall'));
    registry.addPublishRequirement(requirement('seat_map'));
    registry.addDeletionBlocker(blocker('has_showtimes'));
    registry.addDeletionBlocker(blocker('has_bookings'));

    expect(registry.publishRequirements().map(({ key }) => key)).toEqual([
      'active_hall',
      'seat_map',
    ]);
    expect(registry.deletionBlockers().map(({ key }) => key)).toEqual([
      'has_showtimes',
      'has_bookings',
    ]);
  });

  it('refuses a key registered twice, or one the built-in rules use', () => {
    const registry = new TheaterLifecycleRegistry();
    registry.addPublishRequirement(requirement('active_hall'));
    registry.addDeletionBlocker(blocker('has_showtimes'));

    expect(() => registry.addPublishRequirement(requirement('active_hall'))).toThrow(/taken/);
    expect(() => registry.addPublishRequirement(requirement('prices'))).toThrow(/taken/);
    expect(() => registry.addPublishRequirement(requirement('hours'))).toThrow(/taken/);
    expect(() => registry.addDeletionBlocker(blocker('has_showtimes'))).toThrow(/taken/);
    expect(() => registry.addDeletionBlocker(blocker('not_draft'))).toThrow(/taken/);
  });

  it('hands out copies, so a caller cannot change what is registered', () => {
    const registry = new TheaterLifecycleRegistry();
    registry.addPublishRequirement(requirement('active_hall'));
    (registry.publishRequirements() as unknown[]).length = 0;
    expect(registry.publishRequirements()).toHaveLength(1);
  });
});
