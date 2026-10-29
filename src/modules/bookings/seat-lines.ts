import { AppError } from '../../common/errors/app-error';
import { money } from '../../common/money/money';
import { ZONES } from '../halls/enums';
import type { BookingSeat, SeatLine } from './types';

/**
 * A booking's seats in seat order: by row letter, then seat number, so `F2` comes before `F10`
 * (the stored label order is byte order, where `F10` sorts first).
 */
export function inSeatOrder(seats: readonly BookingSeat[]): BookingSeat[] {
  return [...seats].sort(
    (a, b) => a.rowLabel.localeCompare(b.rowLabel, 'en') || a.seatNumber - b.seatNumber,
  );
}

/**
 * The payment table's seat lines (PRD C8, C11): one line per zone and price, zones front to back,
 * each with its labels in seat order, the count, the unit price and the amount. A zone whose
 * seats were held at two prices (a re-price between two edits, U14) gives two lines, cheaper first.
 */
export function seatLinesOf(seats: readonly BookingSeat[]): SeatLine[] {
  const groups = new Map<string, BookingSeat[]>();
  for (const seat of inSeatOrder(seats)) {
    const key = `${seat.zone}|${seat.price.amount}|${seat.price.currency}`;
    const group = groups.get(key);
    if (group) group.push(seat);
    else groups.set(key, [seat]);
  }
  return [...groups.values()]
    .map((group): SeatLine => {
      const [first] = group;
      if (!first) throw new AppError('INTERNAL', 'A seat line has no seats.');
      return {
        zone: first.zone,
        labels: group.map((seat) => seat.label),
        count: group.length,
        unitPrice: first.price,
        amount: money(first.price.amount * group.length, first.price.currency),
      };
    })
    .sort(
      (a, b) =>
        ZONES.indexOf(a.zone) - ZONES.indexOf(b.zone) || a.unitPrice.amount - b.unitPrice.amount,
    );
}
