import { bookingTicketsSmsTemplate } from '../../../../../src/modules/bookings/templates/booking-tickets-sms.template';
import { bookingTicketsTemplate } from '../../../../../src/modules/bookings/templates/booking-tickets.template';
import type { BookingTicketsParams } from '../../../../../src/modules/bookings/types';
import { deliveryLinks, storageLinks } from '../../../../../src/modules/messaging/links';
import { escapeHtml } from '../../../../../src/modules/messaging/simple-html';

const BASE = 'https://maqady.example';
const PARAMS: BookingTicketsParams = {
  reference: 'MQ-7K3P9Q',
  customerName: 'Mona <Adel>',
  movieTitle: 'The Nile Light',
  ageRating: '12+',
  theaterName: 'Zamalek',
  theaterAddress: '26th of July St, Zamalek, Cairo',
  hallName: 'Hall 1',
  startsAt: 'Fri 16 Oct 2026, 19:30',
  seats: 'F7, F8',
  admits: 2,
  total: 'EGP 380',
  qrCode: 'MQ1.MQ-7K3P9Q.1.Rk2xV9bQm4Tz8LpW3nYc1A',
};
const SECRET_FORMS = [
  PARAMS.qrCode,
  encodeURIComponent(PARAMS.qrCode),
  escapeHtml(PARAMS.qrCode),
  'Rk2xV9bQm4Tz8LpW3nYc1A',
];

describe('the tickets messages (design 7.9, 13.1)', () => {
  it('stores the email with the ticket link redacted and no form of the QR payload', () => {
    const stored = bookingTicketsTemplate.render(PARAMS, storageLinks(BASE));
    const all = [stored.subject, stored.text, stored.html].join('\n');
    expect(stored.subject).toBe('Your Maqady tickets · MQ-7K3P9Q');
    expect(stored.text).toContain('Your ticket QR code: [one-time link hidden]');
    expect(stored.html).toContain('Show ticket QR code: [one-time link hidden]');
    for (const form of SECRET_FORMS) expect(all).not.toContain(form);
    expect(stored.text).toContain(`${BASE}/my-bookings/MQ-7K3P9Q`);
    expect(stored.html).toContain('Mona &lt;Adel&gt;');
    expect(bookingTicketsTemplate.secretParams).toEqual(['qrCode']);
  });

  it('sends the email with the real ticket link to the page that draws the code', () => {
    const sent = bookingTicketsTemplate.render(PARAMS, deliveryLinks(BASE));
    const link = `${BASE}/ticket?token=${encodeURIComponent(PARAMS.qrCode)}`;
    expect(sent.text).toContain(`Your ticket QR code: ${link}`);
    expect(sent.html).toContain(`href="${escapeHtml(link)}"`);
    for (const line of [
      'The Nile Light (12+)',
      'Fri 16 Oct 2026, 19:30',
      'Zamalek, 26th of July St, Zamalek, Cairo',
      'Hall Hall 1 · Seats F7, F8',
      'Admits 2 · Total paid EGP 380',
      "This booking can't be cancelled or refunded.",
    ]) {
      expect(sent.text).toContain(line);
    }
  });

  it('greets a booking without a contact name plainly', () => {
    const sent = bookingTicketsTemplate.render(
      { ...PARAMS, customerName: null },
      deliveryLinks(BASE),
    );
    expect(sent.text.startsWith('Hello,')).toBe(true);
  });

  it('sends the SMS with the essentials and the same link, redacted in its stored copy', () => {
    const stored = bookingTicketsSmsTemplate.render(PARAMS, storageLinks(BASE));
    expect(stored).toEqual({
      text: 'Maqady MQ-7K3P9Q: The Nile Light, Fri 16 Oct 2026, 19:30, Zamalek hall Hall 1, seats F7, F8. Ticket: [one-time link hidden]',
    });
    for (const form of SECRET_FORMS) expect(stored.text).not.toContain(form);
    const sent = bookingTicketsSmsTemplate.render(PARAMS, deliveryLinks(BASE));
    expect(sent.text).toContain(`${BASE}/ticket?token=${encodeURIComponent(PARAMS.qrCode)}`);
    expect(bookingTicketsSmsTemplate.channel).toBe('sms');
  });
});
