import { randomToken, safeEqual, sha256Hex } from '../../common/crypto/hashing';
import { HOLD_CODE_PATTERN } from './bookings.constants';
import type { NewHoldCode } from './types';

/**
 * Guest hold codes (design §7.3 step 7, §10.4): 32 random bytes as base64url, returned once.
 * Only the SHA-256 is stored, and a code is checked by comparing hashes in constant time.
 */

export function newHoldCode(): NewHoldCode {
  const code = randomToken();
  return { code, hash: sha256Hex(code) };
}

/** A well-formed code, or undefined: a missing or malformed code is the same as none. */
export function wellFormedHoldCode(code: string | undefined): string | undefined {
  return code !== undefined && HOLD_CODE_PATTERN.test(code) ? code : undefined;
}

/** The hash a well-formed code would be stored under; undefined for no code. */
export function holdCodeHash(code: string | undefined): string | undefined {
  const wellFormed = wellFormedHoldCode(code);
  return wellFormed === undefined ? undefined : sha256Hex(wellFormed);
}

/** True when `code` is well formed and hashes to `storedHash`. */
export function holdCodeMatches(code: string | undefined, storedHash: string | null): boolean {
  const hash = holdCodeHash(code);
  return hash !== undefined && storedHash !== null && safeEqual(hash, storedHash);
}
