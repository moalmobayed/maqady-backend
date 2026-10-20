import type { AppConfig } from '../../../../src/common/config/types';
import { DataEncryptionService } from '../../../../src/common/crypto/data-encryption.service';
import { keyIdOf } from '../../../../src/common/crypto/keyring';
import { AppError } from '../../../../src/common/errors/app-error';

const KEY = Buffer.alloc(32, 0x0a);
const OTHER_KEY = Buffer.alloc(32, 0x0b);

function service(key: Buffer, previousKey?: Buffer): DataEncryptionService {
  const encryption = {
    key: key.toString('base64'),
    ...(previousKey ? { previousKey: previousKey.toString('base64url') } : {}),
  };
  return new DataEncryptionService({ encryption } as AppConfig);
}

describe('DataEncryptionService', () => {
  const plaintext = JSON.stringify({ holdCode: 'H-1234-SECRET', seats: ['C4', 'C5'] });

  it('round-trips text, in the v1.<keyId>.<nonce>.<data>.<tag> format', () => {
    const encryption = service(KEY);
    const ciphertext = encryption.encrypt(plaintext, 'idempotency:anonymous:k1');
    const parts = ciphertext.split('.');
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe('v1');
    expect(parts[1]).toBe(keyIdOf(KEY));
    expect(Buffer.from(parts[2]!, 'base64url')).toHaveLength(12);
    expect(Buffer.from(parts[4]!, 'base64url')).toHaveLength(16);
    expect(ciphertext).not.toContain('SECRET');
    expect(encryption.decrypt(ciphertext, 'idempotency:anonymous:k1')).toBe(plaintext);
  });

  it('uses a fresh nonce every time, so equal plaintexts never look equal', () => {
    const encryption = service(KEY);
    expect(encryption.encrypt(plaintext)).not.toBe(encryption.encrypt(plaintext));
  });

  it('round-trips empty and non-ASCII text', () => {
    const encryption = service(KEY);
    expect(encryption.decrypt(encryption.encrypt(''))).toBe('');
    expect(encryption.decrypt(encryption.encrypt('مقعدي ✓'))).toBe('مقعدي ✓');
  });

  it('refuses a tampered ciphertext with INTERNAL', () => {
    const encryption = service(KEY);
    const parts = encryption.encrypt(plaintext).split('.');
    const data = Buffer.from(parts[3]!, 'base64url');
    data[0] = data[0]! ^ 0xff;
    parts[3] = data.toString('base64url');
    expect(() => encryption.decrypt(parts.join('.'))).toThrow(AppError);
    expect(() => encryption.decrypt(parts.join('.'))).toThrow('could not be decrypted');
  });

  it('refuses a ciphertext moved to another row: the associated data must match', () => {
    const encryption = service(KEY);
    const ciphertext = encryption.encrypt(plaintext, 'idempotency:customer:1:k1');
    expect(() => encryption.decrypt(ciphertext, 'idempotency:customer:2:k1')).toThrow(AppError);
  });

  it('decrypts with the previous key after a rotation, and encrypts with the new one', () => {
    const before = service(OTHER_KEY);
    const old = before.encrypt(plaintext);
    const rotated = service(KEY, OTHER_KEY);
    expect(rotated.decrypt(old)).toBe(plaintext);
    expect(rotated.encrypt(plaintext).split('.')[1]).toBe(keyIdOf(KEY));
  });

  it('refuses a ciphertext of an unknown key, or in an unknown format', () => {
    const old = service(OTHER_KEY).encrypt(plaintext);
    const encryption = service(KEY);
    expect(() => encryption.decrypt(old)).toThrow('could not be decrypted');
    expect(() => encryption.decrypt('v2.abc.def')).toThrow('could not be decrypted');
    expect(() => encryption.decrypt(old.replace(/^v1/, 'v9'))).toThrow('could not be decrypted');
  });
});
