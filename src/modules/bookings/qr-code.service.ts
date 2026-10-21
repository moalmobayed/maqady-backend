import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../common/config/config.constants';
import type { AppConfig } from '../../common/config/types';
import { decodeSecret } from '../../common/config/validators';
import { AppError } from '../../common/errors/app-error';
import { signQr, verifyQr } from './qr-code';
import type { QrPayload } from './types';

/**
 * Signs and verifies ticket QR payloads under `QR_SIGNING_KEY` (design §7.9). Exported for the
 * box office's scanning (U13), which looks the booking up from a verified payload and then
 * checks the version, the showtime and the check-in.
 */
@Injectable()
export class QrCodeService {
  private readonly key: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const key = decodeSecret(config.tickets.qrSigningKey);
    if (!key) throw new AppError('INTERNAL', 'QR_SIGNING_KEY is not base64.');
    this.key = key;
  }

  payloadFor(reference: string, version: number): string {
    return signQr(this.key, reference, version);
  }

  /** The reference and version of a genuine payload; null for a malformed or forged one. */
  verify(code: string): QrPayload | null {
    return verifyQr(this.key, code);
  }
}
