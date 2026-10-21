import { createHmac } from 'node:crypto';
import { parseQr, signQr, verifyQr } from '../../../../src/modules/bookings/qr-code';

const KEY = Buffer.alloc(32, 0x44);
const OTHER_KEY = Buffer.alloc(32, 0x45);

describe('ticket QR payloads (design 7.9)', () => {
  it('signs MQ1.<reference>.<version> with the first 16 bytes of HMAC-SHA256 as base64url', () => {
    const payload = signQr(KEY, 'MQ-7K3P9Q', 1);
    const expected = createHmac('sha256', KEY)
      .update('MQ1.MQ-7K3P9Q.1')
      .digest()
      .subarray(0, 16)
      .toString('base64url');
    expect(payload).toBe(`MQ1.MQ-7K3P9Q.1.${expected}`);
    expect(payload).toMatch(/^MQ1\.MQ-[2-9A-HJKMNP-Z]{6}\.[1-9][0-9]{0,4}\.[A-Za-z0-9_-]{22}$/);
  });

  it('verifies its own payloads and gives back the reference and version', () => {
    expect(verifyQr(KEY, signQr(KEY, 'MQ-7K3P9Q', 1))).toEqual({
      reference: 'MQ-7K3P9Q',
      version: 1,
    });
    expect(verifyQr(KEY, signQr(KEY, 'MQ-ABCDEF', 12))).toEqual({
      reference: 'MQ-ABCDEF',
      version: 12,
    });
  });

  it('refuses every tampered or malformed form', () => {
    const payload = signQr(KEY, 'MQ-7K3P9Q', 1);
    const signature = payload.split('.')[3]!;
    const flipped = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;
    for (const code of [
      `MQ1.MQ-7K3P9R.1.${signature}`,
      `MQ1.MQ-7K3P9Q.2.${signature}`,
      `MQ1.MQ-7K3P9Q.1.${flipped}`,
      `MQ1.MQ-7K3P9Q.0.${signature}`,
      `MQ1.MQ-7K3P9Q.01.${signature}`,
      `mq1.MQ-7K3P9Q.1.${signature}`,
      `MQ2.MQ-7K3P9Q.1.${signature}`,
      `${payload}.x`,
      ` ${payload}`,
      'MQ-7K3P9Q',
      '',
    ]) {
      expect(verifyQr(KEY, code)).toBeNull();
    }
    expect(verifyQr(OTHER_KEY, payload)).toBeNull();
    expect(parseQr(`MQ1.MQ-7K3P9Q.01.${signature}`)).toBeNull();
  });
});
