import { AppError } from '../errors/app-error';
import { CURRENCIES, DEFAULT_CURRENCY } from './enums';
import { MINOR_UNITS_PER_MAJOR } from './money.constants';
import type { Currency, Money } from './types';

/**
 * Money helpers. Amounts are integers of minor units, so arithmetic is exact; every helper
 * refuses a non-integer or unsafe amount and mixing currencies, which would be a bug.
 */

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

/** A money value, checked. `money(19000)` is EGP 190.00. */
export function money(amount: number, currency: Currency = DEFAULT_CURRENCY): Money {
  assertAmount(amount);
  if (!isCurrency(currency)) throw new AppError('INTERNAL', 'Unsupported currency.');
  return { amount, currency };
}

export function zeroMoney(currency: Currency = DEFAULT_CURRENCY): Money {
  return money(0, currency);
}

export function addMoney(first: Money, second: Money): Money {
  assertSameCurrency(first, second);
  return money(first.amount + second.amount, first.currency);
}

export function subtractMoney(first: Money, second: Money): Money {
  assertSameCurrency(first, second);
  return money(first.amount - second.amount, first.currency);
}

/** A unit price times a whole quantity, for example a seat price times the seat count. */
export function multiplyMoney(value: Money, quantity: number): Money {
  if (!Number.isSafeInteger(quantity)) {
    throw new AppError('INTERNAL', 'A money quantity must be an integer.');
  }
  return money(value.amount * quantity, value.currency);
}

/** The sum of values in one currency; zero for an empty list. */
export function sumMoney(values: readonly Money[], currency: Currency = DEFAULT_CURRENCY): Money {
  return values.reduce((total, value) => addMoney(total, value), zeroMoney(currency));
}

/**
 * Money as messages and tickets show it to people (design-inventory "Currency format"): the
 * currency, then whole units with `en-US` grouping, and piastres only when there are some:
 * `EGP 380`, `EGP 1,234`, `EGP 190.50`. Never parsed back; the API writes `{ amount, currency }`.
 */
export function formatMoneyDisplay(value: Money): string {
  assertAmount(value.amount);
  const hasMinorUnits = value.amount % MINOR_UNITS_PER_MAJOR !== 0;
  const units = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: hasMinorUnits ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value.amount / MINOR_UNITS_PER_MAJOR);
  return `${value.currency} ${units}`;
}

export function isSameMoney(first: Money, second: Money): boolean {
  return first.currency === second.currency && first.amount === second.amount;
}

function assertAmount(amount: number): void {
  if (!Number.isSafeInteger(amount)) {
    throw new AppError('INTERNAL', 'A money amount must be a whole number of minor units.');
  }
}

function assertSameCurrency(first: Money, second: Money): void {
  if (first.currency !== second.currency) {
    throw new AppError('INTERNAL', 'Money values in different currencies cannot be combined.');
  }
}
