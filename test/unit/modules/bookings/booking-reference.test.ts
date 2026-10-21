import { drawReference } from '../../../../src/modules/bookings/booking-reference';
import {
  REFERENCE_ALPHABET,
  REFERENCE_PATTERN,
} from '../../../../src/modules/bookings/bookings.constants';

describe('drawReference', () => {
  it('draws MQ- and 6 characters of the alphabet, which has no 0, O, 1, I or L', () => {
    expect(REFERENCE_ALPHABET).toHaveLength(31);
    expect(REFERENCE_ALPHABET).not.toMatch(/[01OIL]/);
    const seen = new Set<string>();
    for (let index = 0; index < 10_000; index += 1) {
      const reference = drawReference();
      expect(reference).toMatch(REFERENCE_PATTERN);
      for (const character of reference.slice(3)) expect(REFERENCE_ALPHABET).toContain(character);
      seen.add(reference);
    }
    // 887 million values: 10,000 draws almost never repeat.
    expect(seen.size).toBeGreaterThan(9_990);
  });
});
