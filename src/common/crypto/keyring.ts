import { createHash } from 'node:crypto';
import { decodeSecret } from '../config/validators';
import type { EncryptionConfig } from '../config/types';
import { KEY_ID_LENGTH } from './crypto.constants';
import type { EncryptionKey, EncryptionKeyring } from './types';

/** The key's id: the first hex characters of its SHA-256. It identifies, never reveals, the key. */
export function keyIdOf(secret: Buffer): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, KEY_ID_LENGTH);
}

function toKey(text: string): EncryptionKey {
  const secret = decodeSecret(text);
  if (!secret) throw new Error('An encryption key is not valid base64');
  return { id: keyIdOf(secret), secret };
}

/** The keyring from the validated configuration: the current key, plus the previous one. */
export function buildKeyring(config: EncryptionConfig): EncryptionKeyring {
  const current = toKey(config.key);
  const keys = [current, ...(config.previousKey ? [toKey(config.previousKey)] : [])];
  return { current, byId: new Map(keys.map((key) => [key.id, key])) };
}
