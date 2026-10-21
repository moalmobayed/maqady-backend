import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { RANDOM_TOKEN_BYTES } from './crypto.constants';

/** SHA-256 of UTF-8 text, as lower-case hex. Stored token hashes and request hashes use it. */
export function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/** HMAC-SHA256 of UTF-8 text under a key, as base64url (opaque references). */
export function hmacSha256(key: Buffer | string, data: string): string {
  return createHmac('sha256', key).update(data, 'utf8').digest('base64url');
}

/**
 * HMAC-SHA256 of UTF-8 text under a key, as the raw 32-byte digest, for callers that truncate it
 * (a ticket QR signature keeps the first 16 bytes, design §7.9).
 */
export function hmacSha256Bytes(key: Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** A random token of 32 bytes as base64url (43 characters): refresh tokens and email links. */
export function randomToken(bytes: number = RANDOM_TOKEN_BYTES): string {
  return randomBytes(bytes).toString('base64url');
}

/** Compares two strings in constant time for equal lengths; false when the lengths differ. */
export function safeEqual(first: string, second: string): boolean {
  const a = Buffer.from(first, 'utf8');
  const b = Buffer.from(second, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
