import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { DUMMY_PASSWORD_HASH, PASSWORD_HASH_PATTERN, SCRYPT_PROFILE } from './auth.constants';
import type { ParsedPasswordHash } from './types';

/**
 * Hashes and checks passwords (design §10.1) with Node's scrypt, OWASP's `N = 2^14, r = 8, p = 5`
 * profile and a 16-byte salt per password. The stored text names its own parameters, so a hash
 * made under an older profile still verifies after the profile changes.
 *
 * Exported for staff (U2a, U2b) and customers (U9). Hashing is asynchronous and runs on libuv's
 * thread pool, so it never blocks the event loop.
 */
@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    const { N, r, p, keyLength, saltBytes } = SCRYPT_PROFILE;
    const salt = randomBytes(saltBytes);
    const key = await derive(password, salt, keyLength, N, r, p);
    return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
  }

  /**
   * True when `password` matches `storedHash`, compared in constant time. With no stored hash
   * (an unknown email, or a member who never set a password) it does the same work against a
   * dummy hash and answers false, so timing reveals nothing. A malformed stored hash is a bug:
   * `INTERNAL`.
   */
  async verify(password: string, storedHash: string | null): Promise<boolean> {
    const parsed = parseHash(storedHash ?? DUMMY_PASSWORD_HASH);
    const key = await derive(
      password,
      parsed.salt,
      parsed.key.length,
      parsed.N,
      parsed.r,
      parsed.p,
    );
    const matches = timingSafeEqual(key, parsed.key);
    return storedHash !== null && matches;
  }
}

function parseHash(stored: string): ParsedPasswordHash {
  const match = PASSWORD_HASH_PATTERN.exec(stored);
  if (!match) throw new AppError('INTERNAL', 'A stored password hash is malformed.');
  const [, n, r, p, salt, key] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  return {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    salt: Buffer.from(salt, 'base64url'),
    key: Buffer.from(key, 'base64url'),
  };
}

function derive(
  password: string,
  salt: Buffer,
  keyLength: number,
  N: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, { N, r, p, maxmem: SCRYPT_PROFILE.maxmem }, (error, key) => {
      if (error)
        reject(new AppError('INTERNAL', 'Password hashing failed.', null, { cause: error }));
      else resolve(key);
    });
  });
}
