import type { CURRENCIES } from './enums';

export type Currency = (typeof CURRENCIES)[number];

/**
 * An amount of money in whole minor units (piastres for EGP), never a float (design §6.1).
 * Stored as an `INT` amount column plus a `currency VARCHAR(3)` column.
 */
export interface Money {
  readonly amount: number;
  readonly currency: Currency;
}
