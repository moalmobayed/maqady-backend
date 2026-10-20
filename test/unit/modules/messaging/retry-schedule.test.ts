import { retryDelayMinutes } from '../../../../src/modules/messaging/retry-schedule';

describe('retryDelayMinutes', () => {
  it('backs off 1, 5, 15, 60 and 180 minutes, then 6 hours for every later attempt', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 9].map(retryDelayMinutes)).toEqual([
      1, 5, 15, 60, 180, 360, 360, 360,
    ]);
  });

  it('treats a count below one as the first attempt', () => {
    expect(retryDelayMinutes(0)).toBe(1);
  });
});
