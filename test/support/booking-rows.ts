import type { BookingRow } from '../../src/modules/bookings/types';

/** A `bookings` row for unit tests of the bookings services (U12): a customer's confirmed online booking. */
export function bookingRow(overrides: Partial<BookingRow> = {}): BookingRow {
  const at = new Date('2026-10-15T14:00:00+03:00');
  return {
    id: 100,
    reference: 'MQ-7K3P9Q',
    showtime_id: 81,
    status: 'confirmed',
    channel: 'online',
    customer_id: 12,
    created_by_staff_id: null,
    hold_token_hash: null,
    hold_expires_at: new Date('2026-10-15T14:05:00+03:00'),
    has_declined_payment: false,
    seat_count: 2,
    total_amount: 38000,
    currency: 'EGP',
    contact_name: 'Mona Adel',
    contact_email: 'mona@example.com',
    contact_phone: '+201012345678',
    confirmed_at: new Date('2026-10-15T14:02:00+03:00'),
    refunded_at: null,
    qr_version: 1,
    created_at: at,
    updated_at: at,
    ...overrides,
  };
}
