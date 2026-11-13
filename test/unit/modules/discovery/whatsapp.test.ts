import { whatsAppUrl } from '../../../../src/modules/discovery/whatsapp';

describe('whatsAppUrl', () => {
  it('is wa.me and the E.164 number without its +', () => {
    expect(whatsAppUrl('+201001234567')).toBe('https://wa.me/201001234567');
    expect(whatsAppUrl('+12025550123')).toBe('https://wa.me/12025550123');
  });
});
