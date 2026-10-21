import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.constants';
import type { AppConfig } from '../config/types';
import { AppError } from '../errors/app-error';
import {
  AUTH_TAG_BYTES,
  CIPHER_ALGORITHM,
  CIPHERTEXT_VERSION,
  NONCE_BYTES,
} from './crypto.constants';
import { buildKeyring } from './keyring';
import type { EncryptionKeyring } from './types';

/**
 * Encryption at rest for data that must be readable again, such as stored idempotency
 * responses (design §14.1): AES-256-GCM under `DATA_ENCRYPTION_KEY`, a random nonce per value.
 *
 * Ciphertext: `v1.<keyId>.<nonce>.<data>.<tag>`, base64url parts. The key id lets a rotated key
 * (`DATA_ENCRYPTION_PREVIOUS_KEY`) still decrypt. `associatedData` binds a ciphertext to where it
 * is stored, so it can't be copied to another row and decrypted there.
 */
@Injectable()
export class DataEncryptionService {
  private readonly keyring: EncryptionKeyring;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.keyring = buildKeyring(config.encryption);
  }

  encrypt(plaintext: string, associatedData = ''): string {
    const { id, secret } = this.keyring.current;
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv(CIPHER_ALGORITHM, secret, nonce, {
      authTagLength: AUTH_TAG_BYTES,
    });
    cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [
      CIPHERTEXT_VERSION,
      id,
      nonce.toString('base64url'),
      data.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
    ].join('.');
  }

  /** The plaintext, or `INTERNAL` when the value was tampered with or its key is unknown. */
  decrypt(ciphertext: string, associatedData = ''): string {
    const parts = ciphertext.split('.');
    const [version, keyId, nonce, data, tag] = parts;
    const key = keyId === undefined ? undefined : this.keyring.byId.get(keyId);
    if (parts.length !== 5 || version !== CIPHERTEXT_VERSION || !key || !nonce || !tag) {
      throw new AppError('INTERNAL', 'A stored value could not be decrypted.');
    }
    try {
      const decipher = createDecipheriv(
        CIPHER_ALGORITHM,
        key.secret,
        Buffer.from(nonce, 'base64url'),
        { authTagLength: AUTH_TAG_BYTES },
      );
      decipher.setAAD(Buffer.from(associatedData, 'utf8'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(data ?? '', 'base64url')),
        decipher.final(),
      ]);
      return plain.toString('utf8');
    } catch (error) {
      throw new AppError('INTERNAL', 'A stored value could not be decrypted.', null, {
        cause: error,
      });
    }
  }
}
