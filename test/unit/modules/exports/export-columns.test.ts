import type { AdminCustomerResponse } from '../../../../src/modules/admin-customers/dto/admin-customer.response';
import type { AdminTransactionResponse } from '../../../../src/modules/analytics/dto/admin-transaction.response';
import type { AdminBookingListItemResponse } from '../../../../src/modules/bookings/dto/admin-booking-list-item.response';
import {
  BOOKING_COLUMNS,
  CUSTOMER_COLUMNS,
  PAYMENT_COLUMNS,
} from '../../../../src/modules/exports/export-columns';
import type { CsvColumn, CsvValue } from '../../../../src/modules/exports/types';

const egp = (amount: number) => ({ amount, currency: 'EGP' as const });

/** The row as `header → cell value`, the way a reader of the file sees it. */
function rowOf<Row>(columns: readonly CsvColumn<Row>[], row: Row): Record<string, CsvValue> {
  return Object.fromEntries(columns.map((column) => [column.header, column.value(row)]));
}

const BOOKING = {
  reference: 'MQ-7K3P9Q',
  status: 'confirmed',
  paymentStatus: 'succeeded',
  channel: 'counter',
  owner: 'staff',
  contact: { name: 'Nadia Farouk', email: 'nadia@example.com', phone: '+201012345678' },
  showtime: {
    id: 81,
    startsAt: '2026-10-16T19:30:00+03:00',
    endsAt: '2026-10-16T21:38:00+03:00',
    cinemaDate: '2026-10-16',
    movie: { id: 12, title: 'The Nile Light', ageRating: 'PG', runtimeMinutes: 128, poster: null },
    theater: {
      id: 3,
      name: 'Zamalek Cinema',
      address: '13 Shagaret El Dor',
      district: 'Zamalek',
      city: 'Cairo',
      latitude: 30.06,
      longitude: 31.22,
    },
    hall: { id: 5, name: 'Hall 1' },
  },
  seatLabels: ['B2', 'B3'],
  seatCount: 2,
  total: egp(38050),
  payment: {
    status: 'succeeded',
    method: 'card_terminal',
    amount: egp(38050),
    receiptReference: 'TRX-77',
    card: null,
    walletType: null,
    createdAt: '2026-10-10T10:00:00+03:00',
    completedAt: '2026-10-10T10:00:00+03:00',
    settlesAt: null,
  },
  createdAt: '2026-10-10T10:00:00+03:00',
  confirmedAt: '2026-10-10T10:00:00+03:00',
  checkedInAt: null,
} as unknown as AdminBookingListItemResponse;

describe('BOOKING_COLUMNS', () => {
  it('reads every column from the list row: money in pounds, seats by spaces, empty nulls', () => {
    expect(rowOf(BOOKING_COLUMNS, BOOKING)).toEqual({
      Reference: 'MQ-7K3P9Q',
      Status: 'confirmed',
      'Payment status': 'succeeded',
      Channel: 'counter',
      Owner: 'staff',
      'Contact name': 'Nadia Farouk',
      'Contact email': 'nadia@example.com',
      'Contact phone': '+201012345678',
      Movie: 'The Nile Light',
      Theater: 'Zamalek Cinema',
      Hall: 'Hall 1',
      'Starts at': '2026-10-16T19:30:00+03:00',
      'Cinema date': '2026-10-16',
      Seats: 'B2 B3',
      'Seat count': 2,
      Total: 380.5,
      Currency: 'EGP',
      'Payment method': 'card_terminal',
      'Card brand': null,
      'Card last 4': null,
      Wallet: null,
      'Receipt reference': 'TRX-77',
      'Created at': '2026-10-10T10:00:00+03:00',
      'Confirmed at': '2026-10-10T10:00:00+03:00',
      'Checked in at': null,
    });
  });

  it('leaves the payment columns empty for a booking with no payment', () => {
    const row = rowOf(BOOKING_COLUMNS, { ...BOOKING, payment: null });
    expect([row['Payment method'], row['Card brand'], row['Receipt reference']]).toEqual([
      null,
      null,
      null,
    ]);
  });
});

describe('CUSTOMER_COLUMNS', () => {
  it('reads the account and its numbers', () => {
    const customer = {
      id: 42,
      fullName: 'Layla Hassan',
      email: 'layla@example.com',
      phone: null,
      status: 'blocked',
      emailVerified: false,
      emailVerifiedAt: null,
      joinedAt: '2026-09-01T11:58:00+03:00',
      lastSignInAt: null,
      updatedAt: '2026-10-10T09:00:00+03:00',
      stats: { bookings: 3, spent: egp(114000), noShows: 1, lastBookingAt: null },
    } as unknown as AdminCustomerResponse;
    expect(rowOf(CUSTOMER_COLUMNS, customer)).toEqual({
      ID: 42,
      'Full name': 'Layla Hassan',
      Email: 'layla@example.com',
      Phone: null,
      Status: 'blocked',
      'Email verified': false,
      'Email verified at': null,
      'Joined at': '2026-09-01T11:58:00+03:00',
      'Last sign-in at': null,
      'Updated at': '2026-10-10T09:00:00+03:00',
      Bookings: 3,
      Spent: 1140,
      Currency: 'EGP',
      'No-shows': 1,
      'Last booking at': null,
    });
  });
});

describe('PAYMENT_COLUMNS', () => {
  it('reads a refund as a negative amount, with its card, staff and booking', () => {
    const refund = {
      id: 12,
      kind: 'refund',
      purpose: 'cancellation',
      method: 'cash',
      channel: 'counter',
      status: 'succeeded',
      failureReason: null,
      ledgerStatus: 'succeeded',
      amount: egp(-15000),
      refundOfPaymentId: 7,
      refundedAmount: null,
      pendingRefundAmount: egp(0),
      booking: { reference: 'MQ-7K3P9Q', channel: 'counter', contactName: null },
      theater: { id: 3, name: 'Zamalek Cinema' },
      card: { brand: 'visa', last4: '4242' },
      walletType: null,
      receiptReference: null,
      collectedBy: { id: 7, fullName: 'Hany Adel' },
      paidOutAt: '2026-10-11T05:59:00+03:00',
      paidOutBy: { id: 8, fullName: 'Mona Saeed' },
      createdAt: '2026-10-10T10:02:00+03:00',
      completedAt: '2026-10-11T05:59:00+03:00',
      occurredAt: '2026-10-11T05:59:00+03:00',
      cinemaDate: '2026-10-10',
      actions: { markPaidOut: false },
    } as unknown as AdminTransactionResponse;
    expect(rowOf(PAYMENT_COLUMNS, refund)).toEqual({
      ID: 12,
      'Occurred at': '2026-10-11T05:59:00+03:00',
      'Cinema date': '2026-10-10',
      Kind: 'refund',
      Purpose: 'cancellation',
      Method: 'cash',
      Channel: 'counter',
      Status: 'succeeded',
      'Failure reason': null,
      'Ledger status': 'succeeded',
      Amount: -150,
      Currency: 'EGP',
      'Refund of payment': 7,
      'Refunded amount': null,
      'Pending refund amount': 0,
      'Booking reference': 'MQ-7K3P9Q',
      'Booking channel': 'counter',
      'Contact name': null,
      'Theater ID': 3,
      Theater: 'Zamalek Cinema',
      'Card brand': 'visa',
      'Card last 4': '4242',
      Wallet: null,
      'Receipt reference': null,
      'Collected by': 'Hany Adel',
      'Paid out at': '2026-10-11T05:59:00+03:00',
      'Paid out by': 'Mona Saeed',
      'Created at': '2026-10-10T10:02:00+03:00',
      'Completed at': '2026-10-11T05:59:00+03:00',
    });
  });
});
