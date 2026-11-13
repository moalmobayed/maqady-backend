import {
  centimetersToMeters,
  metersToCentimeters,
  screenColumns,
  screenOf,
} from '../../../../src/modules/halls/hall-screen';

describe('hall screen sizes (#29 P4)', () => {
  it.each([
    [22.1, 2210],
    [12.3, 1230],
    [12.35, 1235],
    [0.29, 29],
    [1, 100],
    [50, 5000],
    [33.33, 3333],
  ])('stores %p m as %p cm and reads it back unchanged', (meters, centimeters) => {
    expect(metersToCentimeters(meters)).toBe(centimeters);
    expect(centimetersToMeters(centimeters)).toBe(meters);
  });

  it('round-trips every 2-decimal size from 1 m to 50 m exactly', () => {
    const drifted: number[] = [];
    for (let cm = 100; cm <= 5000; cm += 1) {
      const meters = Number((cm / 100).toFixed(2));
      if (metersToCentimeters(meters) !== cm || centimetersToMeters(cm) !== meters) {
        drifted.push(cm);
      }
    }
    expect(drifted).toEqual([]);
  });

  it('maps a screen to both columns and null to two nulls', () => {
    expect(screenColumns({ widthMeters: 22.1, heightMeters: 12.3 })).toEqual({
      screen_width_cm: 2210,
      screen_height_cm: 1230,
    });
    expect(screenColumns(null)).toEqual({ screen_width_cm: null, screen_height_cm: null });
  });

  it('reads a screen only when both columns are set', () => {
    expect(screenOf(2210, 1230)).toEqual({ widthMeters: 22.1, heightMeters: 12.3 });
    expect(screenOf(null, null)).toBeNull();
    expect(screenOf(2210, null)).toBeNull();
  });
});
