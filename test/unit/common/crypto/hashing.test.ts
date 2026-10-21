import {
  hmacSha256,
  hmacSha256Bytes,
  randomToken,
  safeEqual,
  sha256Hex,
} from '../../../../src/common/crypto/hashing';

describe('hashing helpers', () => {
  it('sha256Hex matches the known digest', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hmacSha256 matches RFC 4231 test case 2, as base64url', () => {
    const expected = Buffer.from(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
      'hex',
    ).toString('base64url');
    expect(hmacSha256('Jefe', 'what do ya want for nothing?')).toBe(expected);
  });

  it('hmacSha256Bytes is the raw 32-byte digest of the same HMAC (RFC 4231 test case 2)', () => {
    const digest = hmacSha256Bytes(Buffer.from('Jefe'), 'what do ya want for nothing?');
    expect(digest).toHaveLength(32);
    expect(digest.toString('hex')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
    // A 16-byte truncation is not the first 22 characters of the full base64url digest.
    expect(digest.subarray(0, 16).toString('base64url')).not.toBe(
      hmacSha256('Jefe', 'what do ya want for nothing?').slice(0, 22),
    );
  });

  it('randomToken is 32 random bytes as base64url', () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(randomToken()).not.toBe(token);
  });

  it('safeEqual compares strings, refusing different lengths', () => {
    expect(safeEqual('same-value', 'same-value')).toBe(true);
    expect(safeEqual('same-value', 'same-valuf')).toBe(false);
    expect(safeEqual('short', 'longer')).toBe(false);
  });
});
