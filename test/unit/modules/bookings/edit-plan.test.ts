import { money } from '../../../../src/common/money/money';
import { planEdit } from '../../../../src/modules/bookings/edit-plan';
import type {
  BookingRow,
  BookingSeatRow,
  EditPlanInput,
} from '../../../../src/modules/bookings/types';
import type { HallSeat } from '../../../../src/modules/halls/types';
import type { LedgerEntry } from '../../../../src/modules/payments/types';

const NOW = new Date('2026-10-10T10:00:00Z');

const row: BookingRow = {
  id: 100,
  reference: 'MQ-7K3P9Q',
  showtime_id: 81,
  status: 'confirmed',
  channel: 'online',
  customer_id: 42,
  created_by_staff_id: null,
  hold_token_hash: null,
  hold_expires_at: NOW,
  has_declined_payment: false,
  seat_count: 2,
  total_amount: 38000,
  currency: 'EGP',
  contact_name: 'Nadia Farouk',
  contact_email: 'nadia@example.com',
  contact_phone: null,
  confirmed_at: NOW,
  refunded_at: null,
  qr_version: 1,
  checked_in_at: null,
  checked_in_by_staff_id: null,
  created_at: NOW,
  updated_at: NOW,
};

const seat = (label: string, price: number): BookingSeatRow => ({
  booking_id: 100,
  seat_label: label,
  row_label: label[0]!,
  seat_number: Number(label.slice(1)),
  zone: label.startsWith('A') ? 'front' : label.startsWith('D') ? 'back' : 'middle',
  price,
  is_wheelchair: false,
});

const hallSeat = (label: string): [string, HallSeat] => [
  label,
  {
    label,
    rowLabel: label[0]!,
    seatNumber: Number(label.slice(1)),
    zone: label.startsWith('A') ? 'front' : label.startsWith('D') ? 'back' : 'middle',
    isWheelchair: label === 'A1',
  },
];

const layout = new Map(['A1', 'A2', 'A3', 'B2', 'B3', 'B4', 'D1'].map(hallSeat));
// The showtime's prices now: middle went up from 190 to 200 since the sale.
const prices = { front: money(15000), middle: money(20000), back: money(23000) };

const charge: LedgerEntry = {
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
  completedAt: NOW,
  createdAt: NOW,
  collectedByStaffId: null,
  paidOutAt: null,
  paidOutByStaffId: null,
  refundable: money(38000),
};

function input(overrides: Partial<EditPlanInput> = {}): EditPlanInput {
  return {
    row,
    currentSeats: [seat('B2', 19000), seat('B3', 19000)],
    target: { showtimeId: 81, prices, layout },
    labels: ['B2', 'B3'],
    contact: undefined,
    ledger: [charge],
    ...overrides,
  };
}

describe('planEdit', () => {
  it('keeps the sold price of a kept seat and prices a new one at the current zone price', () => {
    const plan = planEdit(input({ labels: ['B4', 'B2'] }));
    expect(plan.seats.map((s) => [s.label, s.price.amount, s.kept])).toEqual([
      ['B2', 19000, true],
      ['B4', 20000, false],
    ]);
    expect(plan.total).toEqual(money(39000));
    expect(plan.previousTotal).toEqual(money(38000));
    expect(plan.difference).toEqual({ direction: 'collect', amount: money(1000) });
    expect(plan.refunds).toEqual([]);
    expect(plan.changedFields).toEqual(['seats']);
    expect(plan).toMatchObject({ seatsChanged: true, showtimeChanged: false });
  });

  it('refunds a lower total across the charges, partially', () => {
    const plan = planEdit(input({ labels: ['A2', 'A3'] }));
    expect(plan.total).toEqual(money(30000));
    expect(plan.difference).toEqual({ direction: 'refund', amount: money(8000) });
    expect(plan.refunds).toEqual([{ charge, amount: money(8000) }]);
  });

  it('prices every seat afresh on another showtime, even the same labels', () => {
    const plan = planEdit(input({ target: { showtimeId: 82, prices, layout } }));
    expect(plan.seats.map((s) => [s.label, s.price.amount, s.kept])).toEqual([
      ['B2', 20000, false],
      ['B3', 20000, false],
    ]);
    expect(plan.changedFields).toEqual(['showtime']);
    expect(plan).toMatchObject({ showtimeChanged: true, seatsChanged: false });
    expect(plan.difference).toEqual({ direction: 'collect', amount: money(2000) });
  });

  it('changes the contact fields given, and clears one sent as null', () => {
    const plan = planEdit(
      input({ contact: { name: 'Laila Hassan', email: null, phone: '+201012345678' } }),
    );
    expect(plan.contact).toEqual({
      name: 'Laila Hassan',
      email: null,
      phone: '+201012345678',
    });
    expect(plan.changedFields).toEqual(['contactName', 'contactEmail', 'contactPhone']);
    expect(plan.difference).toEqual({ direction: 'none', amount: money(0) });
  });

  it('refuses a seat that is not in the target hall, naming its index', () => {
    expect(() => planEdit(input({ labels: ['B2', 'P20'] }))).toThrow(
      expect.objectContaining({
        code: 'VALIDATION_FAILED',
        details: {
          fields: [{ field: 'seats.1', messages: ['P20 is not a seat in this hall.'] }],
        },
      }),
    );
  });

  it('refuses an edit that changes nothing', () => {
    expect(() =>
      planEdit(input({ labels: ['B3', 'B2'], contact: { name: 'Nadia Farouk' } })),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });
});
