import { randomInt } from 'node:crypto';
import { REFERENCE_ALPHABET, REFERENCE_LENGTH, REFERENCE_PREFIX } from './bookings.constants';

/**
 * A new booking reference (design §7.9): `MQ-` and 6 characters drawn with `crypto.randomInt`
 * from an alphabet without 0, O, 1, I or L, so it reads aloud and types without mistakes. About
 * 887 million values; the insert draws again on the rare collision.
 */
export function drawReference(): string {
  let reference = REFERENCE_PREFIX;
  for (let index = 0; index < REFERENCE_LENGTH; index += 1) {
    reference += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  }
  return reference;
}
