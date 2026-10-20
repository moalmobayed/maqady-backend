import { deliveryLinks, storageLinks } from '../../../../../src/modules/messaging/links';
import { showtimeMovedSmsTemplate } from '../../../../../src/modules/showtimes/templates/showtime-moved-sms.template';
import { showtimeMovedTemplate } from '../../../../../src/modules/showtimes/templates/showtime-moved.template';
import type { ShowtimeMovedParams } from '../../../../../src/modules/showtimes/types';

const BASE = 'https://maqady.example';
const PARAMS: ShowtimeMovedParams = {
  bookingReference: 'MQ-7K2P9X',
  movieTitle: 'The Nile <Light>',
  theaterName: 'Zamalek Cinema',
  hallName: 'Hall 3',
  previousStartsAt: 'Fri 16 Oct 2026, 19:30',
  startsAt: 'Fri 16 Oct 2026, 21:00',
};

describe('showtime moved templates', () => {
  it('are an email and an SMS named after their trigger, with no secrets', () => {
    expect([showtimeMovedTemplate.name, showtimeMovedTemplate.channel]).toEqual([
      'showtime.moved',
      'email',
    ]);
    expect([showtimeMovedSmsTemplate.name, showtimeMovedSmsTemplate.channel]).toEqual([
      'showtime.moved_sms',
      'sms',
    ]);
    expect(showtimeMovedTemplate.secretParams).toEqual([]);
    expect(showtimeMovedSmsTemplate.secretParams).toEqual([]);
  });

  it('tells the holder the new and the old time, with the booking and a link to it', () => {
    const email = showtimeMovedTemplate.render(PARAMS, storageLinks(BASE));
    expect(email.subject).toBe('New time for The Nile <Light>: Fri 16 Oct 2026, 21:00');
    expect(email.text).toContain('New time: Fri 16 Oct 2026, 21:00 (was Fri 16 Oct 2026, 19:30).');
    expect(email.text).toContain('Zamalek Cinema, Hall 3');
    expect(email.text).toContain('MQ-7K2P9X');
    expect(email.text).toContain(`${BASE}/bookings/MQ-7K2P9X`);
    expect(email.html).toContain(`href="${BASE}/bookings/MQ-7K2P9X"`);
    // The title is escaped in HTML.
    expect(email.html).toContain('The Nile &lt;Light&gt;');
    expect(email.html).not.toContain('<Light>');
    // Nothing is secret, so the stored and the sent copy are the same.
    expect(showtimeMovedTemplate.render(PARAMS, deliveryLinks(BASE))).toEqual(email);
  });

  it('fits the essentials in one SMS', () => {
    const sms = showtimeMovedSmsTemplate.render(PARAMS, storageLinks(BASE));
    expect(sms.subject).toBeUndefined();
    expect(sms.html).toBeUndefined();
    expect(sms.text).toBe(
      'Maqady: The Nile <Light> at Zamalek Cinema has moved to Fri 16 Oct 2026, 21:00. Booking MQ-7K2P9X stays valid.',
    );
  });
});
