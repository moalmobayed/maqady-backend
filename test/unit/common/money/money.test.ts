import {
  addMoney,
  isCurrency,
  isSameMoney,
  money,
  multiplyMoney,
  subtractMoney,
  sumMoney,
  zeroMoney,
} from '../../../../src/common/money/money';
import type { Money } from '../../../../src/common/money/types';

describe('Money', () => {
  it('holds whole piastres in EGP by default', () => {
    expect(money(19000)).toEqual({ amount: 19000, currency: 'EGP' });
    expect(zeroMoney()).toEqual({ amount: 0, currency: 'EGP' });
  });

  it('adds, subtracts, multiplies and sums exactly', () => {
    expect(addMoney(money(19000), money(250))).toEqual(money(19250));
    expect(subtractMoney(money(19000), money(20000))).toEqual(money(-1000));
    expect(multiplyMoney(money(19000), 3)).toEqual(money(57000));
    expect(sumMoney([money(10), money(20), money(30)])).toEqual(money(60));
    expect(sumMoney([])).toEqual(zeroMoney());
  });

  it('compares by amount and currency', () => {
    expect(isSameMoney(money(100), money(100))).toBe(true);
    expect(isSameMoney(money(100), money(101))).toBe(false);
  });

  it('refuses fractions of a piastre, unsafe integers and fractional quantities', () => {
    expect(() => money(190.5)).toThrow('whole number of minor units');
    expect(() => money(Number.MAX_SAFE_INTEGER + 1)).toThrow('whole number of minor units');
    expect(() => multiplyMoney(money(100), 1.5)).toThrow('must be an integer');
  });

  it('refuses unknown currencies and mixing currencies', () => {
    expect(isCurrency('EGP')).toBe(true);
    expect(isCurrency('USD')).toBe(false);
    const dollars = { amount: 100, currency: 'USD' } as unknown as Money;
    expect(() => money(100, 'USD' as Money['currency'])).toThrow('Unsupported currency');
    expect(() => addMoney(money(100), dollars)).toThrow('different currencies');
  });
});
