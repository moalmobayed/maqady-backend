import { AppError } from '../../../../src/common/errors/app-error';
import { deliveryLinks, storageLinks } from '../../../../src/modules/messaging/links';
import { REDACTED_LINK } from '../../../../src/modules/messaging/messaging.constants';

const BASE = 'https://maqady.example';

describe('message links', () => {
  it('joins a page path to the frontend base URL and encodes the query', () => {
    const links = deliveryLinks(BASE);
    expect(links.page('/bookings/MQ-7K2P')).toBe('https://maqady.example/bookings/MQ-7K2P');
    expect(links.page('/movies', { q: 'a&b c' })).toBe('https://maqady.example/movies?q=a%26b+c');
  });

  it('writes the real one-time link only in the delivery copy', () => {
    expect(deliveryLinks(BASE).oneTime('/verify-email', 'abc_DEF-123')).toBe(
      'https://maqady.example/verify-email?token=abc_DEF-123',
    );
    expect(storageLinks(BASE).oneTime('/verify-email', 'abc_DEF-123')).toBe(REDACTED_LINK);
    expect(REDACTED_LINK).toBe('[one-time link hidden]');
  });

  it('keeps ordinary pages in the stored copy', () => {
    expect(storageLinks(BASE).page('/me/bookings')).toBe('https://maqady.example/me/bookings');
  });

  it('refuses a path that is not rooted, or would change the host, in both builders', () => {
    for (const links of [deliveryLinks(BASE), storageLinks(BASE)]) {
      expect(() => links.page('verify-email')).toThrow(AppError);
      expect(() => links.oneTime('//evil.example/x', 't')).toThrow(AppError);
    }
    expect(() => deliveryLinks(BASE).oneTime('/verify-email', '')).toThrow(AppError);
  });
});
