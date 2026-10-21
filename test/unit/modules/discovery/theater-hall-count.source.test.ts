import { ActiveHallCountSource } from '../../../../src/modules/discovery/theater-hall-count.source';
import type { HallReadService } from '../../../../src/modules/halls/hall-read.service';
import type { HallSummary } from '../../../../src/modules/halls/types';

describe('ActiveHallCountSource', () => {
  let halls: jest.Mocked<Pick<HallReadService, 'listByTheaters'>>;
  let source: ActiveHallCountSource;

  beforeEach(() => {
    halls = {
      listByTheaters: jest.fn().mockResolvedValue(
        new Map([
          [3, [{ id: 7 }, { id: 8 }] as HallSummary[]],
          [1, []],
        ]),
      ),
    };
    source = new ActiveHallCountSource(halls as unknown as HallReadService);
  });

  it('counts the active halls of every theater asked for, 0 for one without', async () => {
    const counts = await source.countsOf([3, 1, 5]);
    expect(halls.listByTheaters).toHaveBeenCalledWith([3, 1, 5], ['active']);
    expect([...counts]).toEqual([
      [3, 2],
      [1, 0],
      [5, 0],
    ]);
  });

  it('reads nothing for no theater', async () => {
    expect(await source.countsOf([])).toEqual(new Map());
    expect(halls.listByTheaters).not.toHaveBeenCalled();
  });
});
