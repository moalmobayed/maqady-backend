import { sha256Hex } from '../../../../src/common/crypto/hashing';
import {
  holdCodeHash,
  holdCodeMatches,
  newHoldCode,
  wellFormedHoldCode,
} from '../../../../src/modules/bookings/hold-code';

describe('hold codes', () => {
  it('makes a 43-character base64url code and stores only its SHA-256', () => {
    const { code, hash } = newHoldCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(sha256Hex(code));
    expect(newHoldCode().code).not.toBe(code);
    expect(holdCodeMatches(code, hash)).toBe(true);
    expect(holdCodeHash(code)).toBe(hash);
  });

  it('treats a missing, malformed or wrong code as no match', () => {
    const { code, hash } = newHoldCode();
    expect(holdCodeMatches(undefined, hash)).toBe(false);
    expect(holdCodeMatches(`${code}x`, sha256Hex(`${code}x`))).toBe(false);
    expect(holdCodeMatches(code.slice(1), hash)).toBe(false);
    expect(holdCodeMatches(newHoldCode().code, hash)).toBe(false);
    expect(holdCodeMatches(code, null)).toBe(false);
    expect(
      wellFormedHoldCode('has spaces in it, which base64url never does......'),
    ).toBeUndefined();
    expect(holdCodeHash(undefined)).toBeUndefined();
  });
});
