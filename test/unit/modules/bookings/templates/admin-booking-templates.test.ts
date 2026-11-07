import { bookingRefundedTemplate } from '../../../../../src/modules/bookings/templates/booking-refunded.template';
import { showtimeCancelledSmsTemplate } from '../../../../../src/modules/bookings/templates/showtime-cancelled-sms.template';
import { showtimeCancelledTemplate } from '../../../../../src/modules/bookings/templates/showtime-cancelled.template';
import type {
  BookingRefundedParams,
  ShowtimeCancelledParams,
} from '../../../../../src/modules/bookings/types';
import { deliveryLinks, storageLinks } from '../../../../../src/modules/messaging/links';

const BASE = 'https://maqady.example';

const REFUNDED: BookingRefundedParams = {
  reference: 'MQ-7K3P9Q',
  customerName: 'Mona <Adel>',
  movieTitle: 'The Nile Light',
  theaterName: 'Zamalek',
  startsAt: 'Sun 11 Oct 2026, 19:30',
  amount: 'EGP 460',
  onlineAmount: 'EGP 380',
  counterAmount: 'EGP 80',
};

const CANCELLED: ShowtimeCancelledParams = {
  reference: 'MQ-7K3P9Q',
  customerName: null,
  movieTitle: 'The Nile Light',
  theaterName: 'Zamalek',
  hallName: 'Hall 3',
  startsAt: 'Sun 11 Oct 2026, 19:30',
  amount: 'EGP 380',
  onlineAmount: 'EGP 380',
  counterAmount: null,
};

describe('the admin booking messages (design 7.7, 13.1)', () => {
  it('tells the customer their booking was cancelled, how much, and where the money goes', () => {
    const sent = bookingRefundedTemplate.render(REFUNDED, deliveryLinks(BASE));
    expect(sent.subject).toBe('Your Maqady booking MQ-7K3P9Q is cancelled and refunded');
    expect(sent.text).toContain('refunded in full: EGP 460');
    expect(sent.text).toContain('EGP 380 goes back to the card or wallet');
    expect(sent.text).toContain('EGP 80 is waiting for you at the box office of Zamalek');
    expect(sent.text).toContain(`${BASE}/my-bookings/MQ-7K3P9Q`);
    expect(sent.html).toContain('Mona &lt;Adel&gt;');
    // Nothing is secret: the stored copy is the sent one.
    expect(bookingRefundedTemplate.secretParams).toEqual([]);
    expect(bookingRefundedTemplate.render(REFUNDED, storageLinks(BASE))).toEqual(sent);
    expect(bookingRefundedTemplate.channel).toBe('email');
  });

  it('leaves out a part the booking did not pay on', () => {
    const online = bookingRefundedTemplate.render(
      { ...REFUNDED, counterAmount: null, amount: 'EGP 380' },
      deliveryLinks(BASE),
    );
    expect(online.text).not.toContain('box office');
    const counter = bookingRefundedTemplate.render(
      { ...REFUNDED, onlineAmount: null, amount: 'EGP 80' },
      deliveryLinks(BASE),
    );
    expect(counter.text).not.toContain('card or wallet');
  });

  it('tells every ticket holder the showtime is cancelled and refunded, by email and SMS', () => {
    const email = showtimeCancelledTemplate.render(CANCELLED, deliveryLinks(BASE));
    expect(email.subject).toBe('Cancelled: The Nile Light on Sun 11 Oct 2026, 19:30');
    expect(email.text).toContain('Hello,');
    expect(email.text).toContain('Zamalek, Hall 3, on Sun 11 Oct 2026, 19:30 has been cancelled');
    expect(email.text).toContain('refunded in full: EGP 380');
    expect(showtimeCancelledTemplate.secretParams).toEqual([]);

    const sms = showtimeCancelledSmsTemplate.render(CANCELLED, deliveryLinks(BASE));
    expect(sms.text).toBe(
      'Maqady MQ-7K3P9Q: The Nile Light on Sun 11 Oct 2026, 19:30 at Zamalek is cancelled. You are refunded EGP 380.',
    );
    expect(showtimeCancelledSmsTemplate.channel).toBe('sms');
    expect(sms.text.length).toBeLessThanOrEqual(160);
  });
});
