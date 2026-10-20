import { AppError } from '../../../../src/common/errors/app-error';
import { HallLifecycleRegistry } from '../../../../src/modules/halls/hall-lifecycle.registry';
import type { HallBlocker } from '../../../../src/modules/halls/types';

const blocker = (key: string, blocked: number[]): HallBlocker => ({
  key,
  blockedIds: jest.fn().mockResolvedValue(new Set(blocked)),
});

describe('HallLifecycleRegistry', () => {
  it('refuses a key registered twice in one list, but allows it in another', () => {
    const registry = new HallLifecycleRegistry();
    registry.addDeletionBlocker(blocker('has_showtimes', []));
    expect(() => registry.addDeletionBlocker(blocker('has_showtimes', []))).toThrow(AppError);
    expect(() => registry.addRetirementBlocker(blocker('has_showtimes', []))).not.toThrow();
    registry.addLayoutParticipant({ key: 'capacity' });
    expect(() => registry.addLayoutParticipant({ key: 'capacity' })).toThrow(AppError);
  });

  it('keeps participants in registration order', () => {
    const registry = new HallLifecycleRegistry();
    registry.addLayoutParticipant({ key: 'b' });
    registry.addLayoutParticipant({ key: 'a' });
    expect(registry.layoutParticipants().map(({ key }) => key)).toEqual(['b', 'a']);
  });

  it('answers the reasons of many halls with one call per blocker, in registration order', async () => {
    const registry = new HallLifecycleRegistry();
    const second = blocker('second', [2, 3]);
    const first = blocker('first', [3]);
    registry.addDeletionBlocker(second);
    registry.addDeletionBlocker(first);
    registry.addRetirementBlocker(blocker('future', [1]));

    const reasons = await registry.deletionReasons([1, 2, 3, 3]);
    expect(Object.fromEntries(reasons)).toEqual({ 1: [], 2: ['second'], 3: ['second', 'first'] });
    expect(second.blockedIds).toHaveBeenCalledTimes(1);
    expect(second.blockedIds).toHaveBeenCalledWith([1, 2, 3]);
    expect(Object.fromEntries(await registry.retirementReasons([1, 2]))).toEqual({
      1: ['future'],
      2: [],
    });
  });

  it('asks no blocker about no halls', async () => {
    const registry = new HallLifecycleRegistry();
    const only = blocker('only', []);
    registry.addDeletionBlocker(only);
    expect((await registry.deletionReasons([])).size).toBe(0);
    expect(only.blockedIds).not.toHaveBeenCalled();
  });
});
