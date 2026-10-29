import { toHistoryEvent } from '../../../../src/modules/bookings/booking-history';

const AT = new Date('2026-10-15T11:02:10.123Z');

describe('toHistoryEvent (PRD C11, design 13.5)', () => {
  it.each([
    ['booking.held', 'seats_held', 'Seats held'],
    ['payment.succeeded', 'payment_received', 'Payment received'],
    ['booking.refunded', 'refunded', 'Refunded'],
    ['booking.edited', 'changed_by_cinema', 'Changed by the cinema'],
    ['showtime.moved', 'changed_by_cinema', 'Changed by the cinema'],
    ['booking.tickets_resent', 'tickets_resent', 'Tickets resent'],
  ])('shows %s as %s', (action, kind, label) => {
    expect(toHistoryEvent({ action, occurredAt: AT })).toEqual({ kind, label, occurredAt: AT });
  });

  it.each([
    'booking.claimed',
    'booking.released',
    'booking.confirmed',
    'payment.declined',
    'payment.cancelled',
    'payment.processing',
    'payment.refunded',
    'booking.checked_in',
    'showtime.cancelled',
    'toString',
    '__proto__',
    'something.else',
  ])('hides %s', (action) => {
    expect(toHistoryEvent({ action, occurredAt: AT })).toBeNull();
  });
});
