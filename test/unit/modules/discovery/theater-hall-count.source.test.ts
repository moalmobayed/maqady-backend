import { NoHallsCountSource } from '../../../../src/modules/discovery/theater-hall-count.source';

describe('NoHallsCountSource', () => {
  it('answers 0 halls for every theater asked for, and only those', async () => {
    const counts = await new NoHallsCountSource().countsOf([3, 1]);
    expect([...counts]).toEqual([
      [3, 0],
      [1, 0],
    ]);
  });
});
