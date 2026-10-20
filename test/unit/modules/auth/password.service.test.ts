import { scryptSync } from 'node:crypto';
import { AppError } from '../../../../src/common/errors/app-error';
import { PasswordService } from '../../../../src/modules/auth/password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes with the design 10.1 profile, a 16-byte salt and a 64-byte key, in a self-describing format', async () => {
    const hash = await service.hash('Cinema2026');
    const [scheme, n, r, p, salt, key, ...rest] = hash.split('$');
    expect({ scheme, n, r, p, rest }).toEqual({
      scheme: 'scrypt',
      n: '16384',
      r: '8',
      p: '5',
      rest: [],
    });
    expect(Buffer.from(salt!, 'base64url')).toHaveLength(16);
    expect(Buffer.from(key!, 'base64url')).toHaveLength(64);

    // The stored key is exactly scrypt of the password under the stored salt and parameters.
    const expected = scryptSync('Cinema2026', Buffer.from(salt!, 'base64url'), 64, {
      N: 16384,
      r: 8,
      p: 5,
      maxmem: 64 * 1024 * 1024,
    });
    expect(Buffer.from(key!, 'base64url').equals(expected)).toBe(true);
  });

  it('salts every hash, so one password never hashes the same twice', async () => {
    const [first, second] = await Promise.all([
      service.hash('Cinema2026'),
      service.hash('Cinema2026'),
    ]);
    expect(first).not.toBe(second);
  });

  it('verifies the right password and refuses a wrong one', async () => {
    const hash = await service.hash('Cinema2026');
    await expect(service.verify('Cinema2026', hash)).resolves.toBe(true);
    await expect(service.verify('cinema2026', hash)).resolves.toBe(false);
    await expect(service.verify('', hash)).resolves.toBe(false);
  });

  it('verifies a hash made under other parameters, read from the stored text', async () => {
    const salt = Buffer.alloc(16, 7);
    const key = scryptSync('Old-profile1', salt, 32, { N: 1024, r: 8, p: 1 });
    const stored = `scrypt$1024$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
    await expect(service.verify('Old-profile1', stored)).resolves.toBe(true);
    await expect(service.verify('Old-profile2', stored)).resolves.toBe(false);
  });

  it('answers false with no stored hash, after doing the same scrypt work', async () => {
    await expect(service.verify('anything1', null)).resolves.toBe(false);
  });

  it('treats a malformed stored hash as a bug (INTERNAL), never as a match', async () => {
    for (const stored of ['bcrypt$x', 'scrypt$16384$8$5$salt', 'plain-text-password']) {
      await expect(service.verify('anything1', stored)).rejects.toMatchObject({
        code: 'INTERNAL',
      });
    }
    await expect(service.verify('anything1', 'x')).rejects.toBeInstanceOf(AppError);
  });
});
