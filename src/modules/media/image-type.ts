import type { DetectedImageType } from './types';

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The file's type from its first bytes (design §9 step 2): JPEG or PNG, else null. The client's
 * `Content-Type` and file name are never consulted, so a renamed file is recognised for what it
 * is.
 */
export function detectImageType(buffer: Buffer): DetectedImageType | null {
  if (startsWith(buffer, JPEG_SIGNATURE)) return 'jpeg';
  if (startsWith(buffer, PNG_SIGNATURE)) return 'png';
  return null;
}

function startsWith(buffer: Buffer, signature: Buffer): boolean {
  return (
    buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature)
  );
}
