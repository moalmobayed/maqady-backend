import { NoShowtimesTickerSource } from '../../../../src/modules/discovery/home-ticker.source';

describe('NoShowtimesTickerSource', () => {
  it('has nothing to show until showtimes exist', async () => {
    expect(await new NoShowtimesTickerSource().tickerFor()).toEqual([]);
  });
});
