import { money } from '../../src/common/money/money';
import type { BookingRow } from '../../src/modules/bookings/types';
import type { LedgerEntry } from '../../src/modules/payments/types';

/**
 * Plain rows for the unit tests of admin bookings (U14): a confirmed online booking and its card
 * charge, overridable field by field. Unit tests only; integration tests build real bookings.
 */
export const ADMIN_NOW = new Date('2026-10-10T07:00:00Z');

export function confirmedRow(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    id: 100,
    reference: 'MQ-7K3P9Q',
    showtime_id: 81,
    status: 'confirmed',
    channel: 'online',
    customer_id: 42,
    created_by_staff_id: null,
    hold_token_hash: null,
    hold_expires_at: ADMIN_NOW,
    has_declined_payment: false,
    seat_count: 2,
    total_amount: 38000,
    currency: 'EGP',
    contact_name: 'Nadia Farouk',
    contact_email: 'nadia@example.com',
    contact_phone: '+201012345678',
    confirmed_at: ADMIN_NOW,
    refunded_at: null,
    qr_version: 1,
    checked_in_at: null,
    checked_in_by_staff_id: null,
    created_at: ADMIN_NOW,
    updated_at: ADMIN_NOW,
    ...overrides,
  };
}

export function ledgerEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: 7,
    bookingId: 100,
    kind: 'charge',
    purpose: 'sale',
    method: 'card',
    status: 'succeeded',
    amount: money(38000),
    refundOfPaymentId: null,
    providerReference: 'sim.sim_card_visa.1.0123456789abcdef',
    card: { brand: 'visa', last4: '4242' },
    walletType: null,
    settlesAt: null,
    completedAt: ADMIN_NOW,
    createdAt: ADMIN_NOW,
    collectedByStaffId: null,
    paidOutAt: null,
    paidOutByStaffId: null,
    refundable: money(38000),
    ...overrides,
  };
}
