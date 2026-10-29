import { money } from '../../../../src/common/money/money';
import type { Zone } from '../../../../src/modules/halls/types';
import { inSeatOrder, seatLinesOf } from '../../../../src/modules/bookings/seat-lines';
import type { BookingSeat } from '../../../../src/modules/bookings/types';

const seat = (label: string, zone: Zone, price: number): BookingSeat => ({
  label,
  rowLabel: label[0]!,
  seatNumber: Number(label.slice(1)),
  zone,
  price: money(price, 'EGP'),
  isWheelchair: false,
});

describe('seat lines (PRD C8, C11)', () => {
  it('orders seats by row, then number, so F2 comes before F10', () => {
    const seats = [
      seat('F10', 'middle', 19000),
      seat('F2', 'middle', 19000),
      seat('B7', 'front', 15000),
    ];
    expect(inSeatOrder(seats).map((s) => s.label)).toEqual(['B7', 'F2', 'F10']);
  });

  it('groups by zone and price, front to back, with count, unit price and amount', () => {
    const lines = seatLinesOf([
      seat('K3', 'back', 23000),
      seat('F10', 'middle', 19000),
      seat('A2', 'front', 15000),
      seat('F2', 'middle', 19000),
      seat('F9', 'middle', 19000),
    ]);
    expect(lines).toEqual([
      {
        zone: 'front',
        labels: ['A2'],
        count: 1,
        unitPrice: money(15000, 'EGP'),
        amount: money(15000, 'EGP'),
      },
      {
        zone: 'middle',
        labels: ['F2', 'F9', 'F10'],
        count: 3,
        unitPrice: money(19000, 'EGP'),
        amount: money(57000, 'EGP'),
      },
      {
        zone: 'back',
        labels: ['K3'],
        count: 1,
        unitPrice: money(23000, 'EGP'),
        amount: money(23000, 'EGP'),
      },
    ]);
  });

  it('gives one zone held at two prices two lines, cheaper first', () => {
    const lines = seatLinesOf([seat('F1', 'middle', 21000), seat('F2', 'middle', 19000)]);
    expect(lines.map((line) => [line.zone, line.labels, line.unitPrice.amount])).toEqual([
      ['middle', ['F2'], 19000],
      ['middle', ['F1'], 21000],
    ]);
  });

  it('has no lines without seats', () => {
    expect(seatLinesOf([])).toEqual([]);
  });
});
