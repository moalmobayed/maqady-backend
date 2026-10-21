import { hmacSha256Bytes, safeEqual } from '../../common/crypto/hashing';
import { QR_PAYLOAD_PATTERN, QR_PREFIX, QR_SIGNATURE_BYTES } from './bookings.constants';
import type { ParsedQr, QrPayload } from './types';

/**
 * Ticket QR payloads (design §7.9; PRD "Tickets and QR codes"): `MQ1.<reference>.<qr_version>.
 * <signature>`, where the signature is HMAC-SHA256 of `MQ1.<reference>.<qr_version>` under
 * `QR_SIGNING_KEY`, its first 16 bytes as base64url (22 characters). Nobody without the key can
 * make one, the reference alone admits nobody, and a new QR version (an edit, U14) voids the old.
 */

/** The signed payload of a booking's ticket. */
export function signQr(key: Buffer, reference: string, version: number): string {
  const body = `${QR_PREFIX}.${reference}.${version}`;
  return `${body}.${signatureOf(key, body)}`;
}

/** A payload taken apart, strictly by its pattern; null for anything else. */
export function parseQr(code: string): ParsedQr | null {
  const match = QR_PAYLOAD_PATTERN.exec(code);
  if (!match) return null;
  return { reference: match[1]!, version: Number(match[2]), signature: match[3]! };
}

/** The reference and version of a payload whose signature verifies under `key`; else null. */
export function verifyQr(key: Buffer, code: string): QrPayload | null {
  const parsed = parseQr(code);
  if (!parsed) return null;
  const expected = signatureOf(key, `${QR_PREFIX}.${parsed.reference}.${parsed.version}`);
  return safeEqual(parsed.signature, expected)
    ? { reference: parsed.reference, version: parsed.version }
    : null;
}

function signatureOf(key: Buffer, body: string): string {
  return hmacSha256Bytes(key, body).subarray(0, QR_SIGNATURE_BYTES).toString('base64url');
}
